import { noteSourceFiles } from '../src/lib/noteSourceFiles'
import { listLocalFiles } from '../src/lib/localFiles'
import { listLocalFileAssociations } from '../src/lib/localFileAssociations'
import { readWorkspace } from '../src/lib/workspaceStorage'
import { readAccountId } from '../src/lib/storage'
import type { Note } from '../src/types/api'
jest.mock('../src/lib/localFiles', () => ({ listLocalFiles: jest.fn() }))
jest.mock('../src/lib/localFileAssociations', () => ({ listLocalFileAssociations: jest.fn() }))
jest.mock('../src/lib/workspaceStorage', () => ({ readWorkspace: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
beforeEach(() => {
  jest.resetAllMocks(); jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(listLocalFiles).mockResolvedValue([{ id: 'file-a', name: '同名.docx' }, { id: 'file-b', name: '同名.docx' }] as never)
  jest.mocked(readWorkspace).mockResolvedValue({ mappings: { saved: { key: 'shared-key', localIds: ['source-task-a'] } }, cache: {} } as never)
})
test('matches saved local source IDs through the exact workspace mapping, never identical titles', async () => {
  jest.mocked(listLocalFileAssociations).mockImplementation(async (_owner, fileId) => [{ state: 'saved', noteId: fileId === 'file-a' ? 'source-task-a' : 'source-task-b' }] as never)
  const result = await noteSourceFiles({ id: 'workspace-shared-key', workspace_key: 'shared-key', title: '同名.docx' } as Note, 'alice')
  expect(result.map(file => file.id)).toEqual(['file-a'])
})
test('does not invent an original from a pending or unknown task', async () => {
  jest.mocked(listLocalFileAssociations).mockResolvedValue([{ state: 'unknown', noteId: 'source-task-a' }] as never)
  expect(await noteSourceFiles({ id: 'source-task-a' } as Note, 'alice')).toEqual([])
})
test('rejects an account switch during an association read', async () => {
  jest.mocked(listLocalFileAssociations).mockImplementation(async () => { jest.mocked(readAccountId).mockResolvedValue('bob'); return [{ state: 'saved', noteId: 'source-task-a' }] as never })
  await expect(noteSourceFiles({ id: 'source-task-a' } as Note, 'alice')).rejects.toThrow('账号已变化')
})
