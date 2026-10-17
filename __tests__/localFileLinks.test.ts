import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { listLocalFileLinks } from '../src/lib/localFiles'
import { listLocalNotes } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
import { localLibrary } from '../src/lib/localLibrary'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'http://127.0.0.1:8900', operationId: jest.fn() }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ importRecording: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listLocalNotes: jest.fn() }))
jest.mock('../src/lib/localLibrary', () => ({ localLibrary: jest.fn(async () => ({ localOnly: true, mappings: {}, cache: {} })) }))
const id = '11111111-1111-4111-8111-111111111111', operation = '22222222-2222-4222-8222-222222222222', task = '33333333-3333-4333-8333-333333333333'
const file = { id, uri: `file:///documents/files/accounts/owner/${id}.pdf`, name: 'source.pdf', size: 100, extension: 'pdf', category: 'file' as const, createdAt: '2026-10-12' }
const association = { owner: 'owner', localFileId: id, operationId: operation, generationOrigin: 'http://127.0.0.1:8900', taskId: task, noteId: `source-${task}`, state: 'saved' }
const local = { id: association.noteId, title: '旧正文', content: '# old', status: 'done', created_at: '2026-10-11', updated_at: '2026-10-11' }
beforeEach(async () => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('owner'); jest.mocked(FS.exists).mockResolvedValue(false)
  jest.mocked(listLocalNotes).mockResolvedValue([local])
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
async function seed(deleted = false) {
  await Storage.setItem(`vinote:owner:local-file-association:${operation}`, JSON.stringify(association))
  jest.mocked(listLocalNotes).mockResolvedValue([{ ...local, title: '当前正文', content: '# new', deleted, updated_at: '2026-10-12' }])
}

test('association resolves the current saved device body by its stable note ID', async () => {
  await seed()
  expect(await listLocalFileLinks(file, 'owner')).toEqual([{ association, noteId: local.id, noteTitle: '当前正文' }])
  expect(listLocalNotes).toHaveBeenCalledWith('owner')
  expect(localLibrary).toHaveBeenCalledWith('owner')
})
test('device trash suppresses its note action while retaining historical source evidence', async () => {
  await seed(true)
  expect(await listLocalFileLinks(file, 'owner')).toEqual([{ association }])
})
test('legacy original with no verified association does not infer a relation or read large note snapshots', async () => {
  expect(await listLocalFileLinks(file, 'owner')).toEqual([])
  expect(listLocalNotes).not.toHaveBeenCalled()
})
test('same file ID in a switched account never yields the former account association', async () => {
  await seed()
  jest.mocked(readAccountId).mockResolvedValue('other')
  await expect(listLocalFileLinks(file, 'owner')).rejects.toThrow('账号已切换')
  expect(listLocalNotes).not.toHaveBeenCalled()
})
