import { resolveWorkspaceSyncTarget, type WorkspaceSyncTarget } from '../src/lib/workspaceSyncTarget'
import type { WorkspaceMapping, WorkspaceState } from '../src/lib/workspaceStorage'

const mapping = { key: 'shared-key', group: 'note:local-a', localIds: ['local-a'], status: 'conflict', pending: { body: { operation_id: 'original-operation' } } } as WorkspaceMapping
const state: WorkspaceState = { mappings: { [mapping.group]: mapping }, cache: {}, serviceOrigin: 'https://workspace.example' }
const target: WorkspaceSyncTarget = { owner: 'owner-a', serviceOrigin: state.serviceOrigin!, key: mapping.key, group: mapping.group, operationId: 'original-operation' }
const resolve = (value: WorkspaceSyncTarget, snapshot = state, owner: string | null = 'owner-a') => resolveWorkspaceSyncTarget(value, owner, snapshot, 'https://workspace.example')

test('shared IDs and the original operation locate only the exact record', () => {
  expect(resolve(target)).toEqual(expect.objectContaining({ status: 'matched', mapping }))
  expect(resolve({ ...target, localId: 'workspace-shared-key' }).status).toBe('missing')
})
test('local-only identity can locate an actual mapping without inventing key or operation', () => {
  expect(resolve({ owner: target.owner, serviceOrigin: target.serviceOrigin, localId: 'local-a' }).mapping).toBe(mapping)
  expect(resolve({ owner: target.owner, serviceOrigin: target.serviceOrigin, localId: 'not-registered' }).status).toBe('missing')
  expect(resolve({ owner: target.owner, serviceOrigin: target.serviceOrigin }).status).toBe('missing')
})
test('confirmed or replaced operations do not rebind the original target', () => {
  for (const next of [{ ...mapping, pending: undefined, status: 'synced' as const }, { ...mapping, pending: { ...mapping.pending!, body: { ...mapping.pending!.body, operation_id: 'new-operation' } } }]) {
    const result = resolve(target, { ...state, mappings: { [mapping.group]: next } })
    expect(result.status).toBe('operation-changed')
    expect(result.mapping).toBeUndefined()
  }
})
test('account and service mismatches never reveal an original-account target record', () => {
  expect(resolve(target, state, null).status).toBe('checking')
  expect(resolve(target, state, 'different-owner').status).toBe('account-changed')
  expect(resolve({ ...target, serviceOrigin: 'https://previous.example' }).status).toBe('service-changed')
  expect(resolve(target, { ...state, serviceOrigin: 'https://previous.example' }).status).toBe('service-changed')
})
test('multiple local matches require explicit inspection, while a real delete receipt can match', () => {
  const other = { ...mapping, group: 'note:another' }
  expect(resolve({ owner: target.owner, serviceOrigin: target.serviceOrigin, localId: 'local-a' }, { ...state, mappings: { a: mapping, b: other } }).status).toBe('ambiguous')
  const deletion = { ...mapping, pending: undefined, deleteOperation: { operation_id: 'original-operation', base_revision: 3 } }
  expect(resolve(target, { ...state, mappings: { a: deletion } }).mapping).toBe(deletion)
})
