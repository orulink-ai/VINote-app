import { readMeetingGroupSources } from '../src/lib/meetingGroupSources'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { listLocalFiles } from '../src/lib/localFiles'
import { listLocalFileAssociations } from '../src/lib/localFileAssociations'
import { readWorkspace } from '../src/lib/workspaceStorage'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import type { Note } from '../src/types/api'

jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn() }))
jest.mock('../src/lib/localFiles', () => ({ listLocalFiles: jest.fn() }))
jest.mock('../src/lib/localFileAssociations', () => ({ listLocalFileAssociations: jest.fn() }))
jest.mock('../src/lib/workspaceStorage', () => ({ readWorkspace: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
const a = { id: 'a', task_id: 'meeting-001', source_type: 'meeting_recording' } as Note
const b = { id: 'workspace-key', workspace_key: 'key', task_id: 'not-a-recording', source_type: 'meeting_audio' } as Note

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(readAccountId).mockResolvedValue('owner-a')
  jest.mocked(listRecordings).mockResolvedValue([{ id: 'meeting-001' }] as never)
  jest.mocked(listLocalFiles).mockResolvedValue([{ id: 'file-001' }] as never)
  jest.mocked(readWorkspace).mockResolvedValue({ mappings: { key: { key: 'key', localIds: ['source-task'] } }, cache: {} } as never)
  jest.mocked(listLocalFileAssociations).mockResolvedValue([{ owner: 'owner-a', localFileId: 'file-001', noteId: 'source-task', state: 'saved' }] as never)
})
test('uses existing account recordings and saved exact source mappings, not arbitrary task IDs', async () => {
  expect((await readMeetingGroupSources([a, b])).sources).toEqual([
    { owner: 'owner-a', noteId: 'a', kind: 'recording', sourceId: 'meeting-001' },
    { owner: 'owner-a', noteId: 'workspace-key', kind: 'file', sourceId: 'file-001' },
  ])
  expect(listLocalFiles).toHaveBeenCalledWith('owner-a')
  expect(listLocalFileAssociations).toHaveBeenCalledWith('owner-a', 'file-001')
})
test.each(['unknown', 'accepted', 'reserved'])('unconfirmed %s receipts cannot authorize grouping', async state => {
  jest.mocked(listLocalFileAssociations).mockResolvedValue([{ owner: 'owner-a', localFileId: 'file-001', noteId: 'source-task', state }] as never)
  expect((await readMeetingGroupSources([b])).sources).toEqual([])
})
test('wrong owner, wrong file, absent original and title lookalikes cannot bind', async () => {
  jest.mocked(listRecordings).mockResolvedValue([])
  jest.mocked(listLocalFileAssociations).mockResolvedValue([
    { owner: 'owner-b', localFileId: 'file-001', noteId: 'source-task', state: 'saved' },
    { owner: 'owner-a', localFileId: 'other-file', noteId: 'source-task', state: 'saved' },
    { owner: 'owner-a', localFileId: 'file-001', noteId: 'same-title', state: 'saved' },
  ] as never)
  expect((await readMeetingGroupSources([a, b])).sources).toEqual([])
})
test('ABA during original read rejects all evidence', async () => {
  jest.mocked(listRecordings).mockImplementation(async () => { transitionIdentity('owner-b'); transitionIdentity('owner-a'); return [] })
  await expect(readMeetingGroupSources([a, b])).rejects.toThrow('账号或服务已切换')
})
