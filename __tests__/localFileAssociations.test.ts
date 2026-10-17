import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { readAccountId } from '../src/lib/storage'
import { advanceLocalFileAssociation, beginLocalFileAssociation, listLocalFileAssociations, markLocalFileDispatch, readLocalFileAssociation } from '../src/lib/localFileAssociations'
import type { LocalFile } from '../src/lib/localFiles'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner-a') }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'http://127.0.0.1:8900' }))
const operation = '11111111-1111-4111-8111-111111111111', task = '22222222-2222-4222-8222-222222222222'
const file: LocalFile = { id: '33333333-3333-4333-8333-333333333333', name: 'example.pdf', extension: 'pdf', size: 123, category: 'file', createdAt: '2026-10-12', uri: 'file:///documents/files/accounts/owner-a/33333333-3333-4333-8333-333333333333.pdf' }
const key = (owner = 'owner-a') => `vinote:${owner}:local-file-association:${operation}`
beforeEach(async () => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockReset().mockResolvedValue('owner-a')
  jest.mocked(FS.readFile).mockReset().mockResolvedValue(JSON.stringify(file))
  jest.mocked(FS.stat).mockReset().mockResolvedValue({ size: 123 } as never)
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})

test('real original, protected dispatch, accepted task and actual saved note survive fresh reads', async () => {
  expect(await beginLocalFileAssociation('owner-a', file, operation)).toMatchObject({ localFileId: file.id, state: 'prepared', generationOrigin: 'http://127.0.0.1:8900' })
  await markLocalFileDispatch('owner-a', operation)
  expect((await readLocalFileAssociation('owner-a', operation))?.state).toBe('unknown')
  await advanceLocalFileAssociation('owner-a', operation, task, 'accepted')
  await Storage.setItem(`vinote:owner-a:note:source-${task}`, JSON.stringify({ id: `source-${task}`, content: '# Result' }))
  await advanceLocalFileAssociation('owner-a', operation, task, 'saved', `source-${task}`)
  expect(await listLocalFileAssociations('owner-a', file.id)).toEqual([expect.objectContaining({ owner: 'owner-a', localFileId: file.id, operationId: operation, taskId: task, noteId: `source-${task}`, state: 'saved' })])
  expect(FS.unlink).not.toHaveBeenCalled()
  expect(JSON.parse((await Storage.getItem(key()))!)).not.toHaveProperty('synced')
})

test('missing original metadata creates no historical or synthetic file association', async () => {
  jest.mocked(FS.readFile).mockRejectedValueOnce(new Error('original metadata missing'))
  await expect(beginLocalFileAssociation('owner-a', file, operation)).rejects.toThrow('metadata missing')
  expect(await Storage.getItem(key())).toBeNull()
  expect(await advanceLocalFileAssociation('owner-a', operation, task, 'accepted')).toBeUndefined()
  expect(await listLocalFileAssociations('owner-a', file.id)).toEqual([])
})

test.each([
  { ...file, uri: file.uri.replace('owner-a', 'owner-b') },
  { ...file, id: 'not-a-real-id' },
])('foreign or fabricated local identity is rejected before metadata access', async invalid => {
  await expect(beginLocalFileAssociation('owner-a', invalid, operation)).rejects.toThrow('不能登记关联')
  expect(FS.readFile).not.toHaveBeenCalled()
  expect(await Storage.getItem(key())).toBeNull()
})

test('changed original size is not bound to its stale metadata', async () => {
  jest.mocked(FS.stat).mockResolvedValueOnce({ size: 456 } as never)
  await expect(beginLocalFileAssociation('owner-a', file, operation)).rejects.toThrow('原文件已变化')
  expect(await Storage.getItem(key())).toBeNull()
})

test('one operation cannot change its real file, task or processing origin', async () => {
  await beginLocalFileAssociation('owner-a', file, operation)
  await advanceLocalFileAssociation('owner-a', operation, task, 'accepted')
  const changed = { ...file, id: '44444444-4444-4444-8444-444444444444', uri: 'file:///documents/files/accounts/owner-a/44444444-4444-4444-8444-444444444444.pdf' }
  await expect(beginLocalFileAssociation('owner-a', changed, operation)).rejects.toThrow('另一来源或服务')
  await expect(advanceLocalFileAssociation('owner-a', operation, changed.id, 'accepted')).rejects.toThrow('任务已变化')
  const stored = JSON.parse((await Storage.getItem(key()))!)
  await Storage.setItem(key(), JSON.stringify({ ...stored, generationOrigin: 'https://previous.example' }))
  await expect(advanceLocalFileAssociation('owner-a', operation, task, 'accepted')).rejects.toThrow('服务或任务已变化')
  expect(JSON.parse((await Storage.getItem(key()))!).generationOrigin).toBe('https://previous.example')
})

test('saving requires the exact task-derived note to exist under the original account', async () => {
  await beginLocalFileAssociation('owner-a', file, operation)
  await advanceLocalFileAssociation('owner-a', operation, task, 'accepted')
  await Storage.setItem(`vinote:owner-b:note:source-${task}`, JSON.stringify({ id: `source-${task}`, content: '# B only' }))
  await expect(advanceLocalFileAssociation('owner-a', operation, task, 'saved', `source-${task}`)).rejects.toThrow('笔记尚未保存')
  expect((await readLocalFileAssociation('owner-a', operation))?.state).toBe('accepted')
  await expect(advanceLocalFileAssociation('owner-a', operation, task, 'saved', 'unrelated-note')).rejects.toThrow('原任务不一致')
})

test('late accepted receipt cannot overwrite a concurrently saved association', async () => {
  await beginLocalFileAssociation('owner-a', file, operation)
  await Storage.setItem(`vinote:owner-a:note:source-${task}`, JSON.stringify({ id: `source-${task}`, content: '# A' }))
  await Promise.all([
    advanceLocalFileAssociation('owner-a', operation, task, 'saved', `source-${task}`),
    advanceLocalFileAssociation('owner-a', operation, task, 'accepted'),
  ])
  expect((await readLocalFileAssociation('owner-a', operation))?.state).toBe('saved')
})

test('switching accounts during original metadata read writes neither B nor an unverified A association', async () => {
  let resolve!: (value: string) => void
  jest.mocked(FS.readFile).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const work = beginLocalFileAssociation('owner-a', file, operation)
  while (!resolve) await Promise.resolve()
  jest.mocked(readAccountId).mockResolvedValue('owner-b')
  resolve(JSON.stringify(file))
  await expect(work).rejects.toThrow('账号已切换')
  expect(await Storage.getItem(key())).toBeNull()
  expect(await Storage.getItem(key('owner-b'))).toBeNull()
})

test('identical file and operation IDs stay in their distinct account namespaces', async () => {
  await beginLocalFileAssociation('owner-a', file, operation)
  jest.mocked(readAccountId).mockResolvedValue('owner-b')
  const b = { ...file, uri: file.uri.replace('owner-a', 'owner-b') }
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(b))
  await beginLocalFileAssociation('owner-b', b, operation)
  expect((await listLocalFileAssociations('owner-b', b.id))[0].owner).toBe('owner-b')
  await expect(listLocalFileAssociations('owner-a', file.id)).rejects.toThrow('账号已切换')
  expect(JSON.parse((await Storage.getItem(key()))!).owner).toBe('owner-a')
})
