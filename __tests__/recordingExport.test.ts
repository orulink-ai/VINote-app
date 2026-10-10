import FS from 'react-native-fs'
import Share from 'react-native-share'
import { readAccountId } from '../src/lib/storage'
import { exportRecording, type LocalRecording } from '../src/features/recording/recordingLibrary'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn(async () => []) }))

const recording: LocalRecording = {
  id: 'long-meeting', title: '客户会议', duration: 3037, createdAt: '',
  uri: 'file:///documents/recordings/accounts/alice/long-meeting.m4a',
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(FS.exists).mockResolvedValue(true)
  jest.mocked(FS.stat).mockResolvedValue({ size: 50_000_000, isFile: () => true } as never)
})

test('shares the complete original file without copying, reencoding or deleting it', async () => {
  await exportRecording(recording)
  expect(FS.stat).toHaveBeenCalledWith('/documents/recordings/accounts/alice/long-meeting.m4a')
  expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({ url: recording.uri, type: 'audio/mp4', failOnCancel: false, saveToFiles: true }))
  expect(FS.copyFile).not.toHaveBeenCalled()
  expect(FS.unlink).not.toHaveBeenCalled()
})

test.each([
  ['missing', false, 50_000_000, true],
  ['empty', true, 0, true],
  ['directory', true, 50_000_000, false],
] as const)('rejects %s audio before invoking the system share sheet', async (_name, exists, size, isFile) => {
  jest.mocked(FS.exists).mockResolvedValue(exists)
  jest.mocked(FS.stat).mockResolvedValue({ size, isFile: () => isFile } as never)
  await expect(exportRecording(recording)).rejects.toThrow('未找到有效录音文件')
  expect(Share.open).not.toHaveBeenCalled()
  expect(FS.unlink).not.toHaveBeenCalled()
})

test('rejects recordings from another account and path traversal', async () => {
  await expect(exportRecording({ ...recording, uri: recording.uri.replace('/alice/', '/bob/') })).rejects.toThrow('不属于当前账号')
  await expect(exportRecording({ ...recording, id: '../outside', uri: 'file:///documents/recordings/accounts/alice/../outside.m4a' })).rejects.toThrow('不属于当前账号')
  expect(Share.open).not.toHaveBeenCalled()
})

test('does not share if the account changes while checking the file', async () => {
  jest.mocked(FS.stat).mockImplementationOnce(async () => {
    jest.mocked(readAccountId).mockResolvedValue('bob')
    return { size: 50_000_000, isFile: () => true } as never
  })
  await expect(exportRecording(recording)).rejects.toThrow('账号已切换')
  expect(Share.open).not.toHaveBeenCalled()
})
