import FS from 'react-native-fs'
import { readAccountId } from '../src/lib/storage'
import { recordingPath, saveRecording, listRecordings, createRecordingDraft, finalizeRecording, importRecording } from '../src/features/recording/recordingLibrary'
import { NativeModules } from 'react-native'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
beforeEach(() => { jest.clearAllMocks(); jest.mocked(FS.exists).mockResolvedValue(false) })

test('draft survives missing audio and failed finalization does not erase metadata', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  const draft = await createRecordingDraft('')
  expect(draft.state).toBe('recording')
  expect(draft.titleSource).toBe('default')
  await expect(finalizeRecording(draft)).rejects.toThrow('未找到有效录音文件')
  jest.mocked(FS.exists).mockImplementation(async path => path.endsWith('/alice'))
  jest.mocked(FS.readDir).mockResolvedValue([{ name: `${draft.id}.json`, path: '/metadata' }] as never)
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(draft))
  const records = await listRecordings()
  expect(records[0]).toMatchObject({ id: draft.id, state: 'interrupted' })
  expect(records[0].error).toContain('未找到')
})

test('cancelled picker does not create a recording; imported source is copied and retained', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  NativeModules.MeetingFiles = { pickAudio: jest.fn(async () => null), releaseAudio: jest.fn(async () => {}) }
  NativeModules.MeetingAudio = { audioInfo: jest.fn(async () => 30) }
  expect(await importRecording()).toBeNull()
  expect(FS.copyFile).not.toHaveBeenCalled()
  NativeModules.MeetingFiles.pickAudio.mockResolvedValue({ uri: 'file:///cache/import-a', name: '客户会议.mp3' })
  jest.mocked(FS.stat).mockResolvedValue({ size: 4096 } as never)
  const record = await importRecording()
  expect(record).toMatchObject({ extension: 'mp3', source: 'import', originalName: '客户会议.mp3', state: 'saved' })
  expect(FS.copyFile).toHaveBeenCalledWith('file:///cache/import-a', expect.stringContaining('/accounts/alice/'))
  expect(NativeModules.MeetingFiles.releaseAudio).toHaveBeenCalled()
})
test('isolates accounts and rejects recordings owned by another account', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  expect(await recordingPath()).toMatch('/accounts/alice/')
  jest.mocked(readAccountId).mockResolvedValue('bob')
  expect(await recordingPath()).toMatch('/accounts/bob/')
  await expect(saveRecording({ id: 'one', uri: 'file:///documents/recordings/accounts/alice/one.m4a', title: 'private', createdAt: '', duration: 1 })).rejects.toThrow('录音不属于当前账号')
  expect(FS.writeFile).not.toHaveBeenCalled()
})
test('unknown legacy account cannot read device-wide recordings', async () => {
  jest.mocked(readAccountId).mockResolvedValue(null)
  await expect(listRecordings()).rejects.toThrow('请联网登录一次')
  expect(FS.readDir).not.toHaveBeenCalled()
})
