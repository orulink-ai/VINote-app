import FS from 'react-native-fs'
import Share from 'react-native-share'
import { NativeModules, Platform } from 'react-native'
import { transitionIdentity } from '../src/lib/sessionIdentity'
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
  transitionIdentity('alice')
  jest.replaceProperty(Platform, 'OS', 'android')
  NativeModules.MeetingFiles = { originalMediaProtocol: 1, exportOriginal: jest.fn(async () => 'saved'), cancelOriginalExport: jest.fn() }
  jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(FS.exists).mockResolvedValue(true)
  jest.mocked(FS.stat).mockResolvedValue({ size: 50_000_000, isFile: () => true } as never)
})

test('exports the complete recording through the real shared native bridge without copying or reading it into JS', async () => {
  await expect(exportRecording(recording)).resolves.toBe('saved')
  expect(FS.stat).toHaveBeenCalledWith('/documents/recordings/accounts/alice/long-meeting.m4a')
  expect(NativeModules.MeetingFiles.exportOriginal).toHaveBeenCalledWith(recording.uri, '客户会议.m4a', 'alice')
  expect(Share.open).not.toHaveBeenCalled()
  expect(FS.readFile).not.toHaveBeenCalled()
  expect(FS.copyFile).not.toHaveBeenCalled()
  expect(FS.unlink).not.toHaveBeenCalled()
})

test('returns system cancellation instead of assuming save success', async () => {
  NativeModules.MeetingFiles.exportOriginal.mockResolvedValueOnce('cancelled')
  await expect(exportRecording(recording)).resolves.toBe('cancelled')
})

test('iOS records use the same OS document export with extension-derived audio MIME', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  jest.mocked(Share.open).mockResolvedValueOnce({ success: true, message: 'saved' })
  await expect(exportRecording(recording)).resolves.toBe('saved')
  expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({ url: recording.uri, type: 'audio/mp4', saveToFiles: true }))
  expect(FS.readFile).not.toHaveBeenCalled()
})

test('ABA identity change during stat cannot open a picker even when the owner name returns', async () => {
  jest.mocked(FS.stat).mockImplementationOnce(async () => {
    transitionIdentity('bob'); transitionIdentity('alice')
    return { size: 50_000_000, isFile: () => true } as never
  })
  await expect(exportRecording(recording)).rejects.toThrow('账号已切换')
  expect(NativeModules.MeetingFiles.exportOriginal).not.toHaveBeenCalled()
})

test('an identity change before the picker completion cannot report an old-owner save', async () => {
  NativeModules.MeetingFiles.exportOriginal.mockImplementationOnce(async () => { transitionIdentity('bob'); return 'saved' })
  await expect(exportRecording(recording)).rejects.toThrow('账号已切换')
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
