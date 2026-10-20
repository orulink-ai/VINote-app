import FS from 'react-native-fs'
import { NativeModules } from 'react-native'
import { importLocalFile, listLocalFiles, setLocalFilePurpose } from '../src/lib/localFiles'
import { importRecording } from '../src/features/recording/recordingLibrary'
import { readAccountId } from '../src/lib/storage'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ operationId: () => '12345678-1234-4234-8234-123456789012' }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ importRecording: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(FS.exists as jest.Mock).mockReset().mockResolvedValue(false)
  ;(readAccountId as jest.Mock).mockResolvedValue('owner')
  ;(FS.stat as jest.Mock).mockResolvedValue({ size: 2000 })
  NativeModules.MeetingFiles = {
    pickFile: jest.fn(async () => ({ uri: 'content://picked/audio', name: 'sample.m4a' })),
    releaseAudio: jest.fn(async () => {}),
  }
})

it('keeps note audio in the file library without creating a meeting recording', async () => {
  const file = await importLocalFile({ keepAudioInFiles: true })
  expect(file).toMatchObject({ category: 'audio', name: 'sample.m4a', purpose: 'note' })
  expect(importRecording).not.toHaveBeenCalled()
  expect(FS.writeFile).toHaveBeenCalled()
  expect(NativeModules.MeetingFiles.releaseAudio).toHaveBeenCalledWith('content://picked/audio')
})

it('preserves the existing explicit recording import route', async () => {
  ;(importRecording as jest.Mock).mockResolvedValue({ id: 'recording' })
  expect(await importLocalFile()).toEqual({ id: 'recording' })
  expect(importRecording).toHaveBeenCalled()
})

it('does not save the chosen file into a switched account', async () => {
  ;(readAccountId as jest.Mock).mockResolvedValueOnce('owner').mockResolvedValueOnce('owner').mockResolvedValueOnce('other')
  await expect(importLocalFile({ keepAudioInFiles: true })).rejects.toThrow('账号已切换')
  expect(FS.copyFile).not.toHaveBeenCalled()
  expect(FS.writeFile).not.toHaveBeenCalled()
  expect(NativeModules.MeetingFiles.releaseAudio).toHaveBeenCalled()
})

it('removes an empty imported copy and does not persist its metadata', async () => {
  ;(FS.stat as jest.Mock).mockResolvedValue({ size: 0 })
  await expect(importLocalFile({ keepAudioInFiles: true })).rejects.toThrow('非空')
  expect(FS.unlink).toHaveBeenCalledWith('/documents/files/accounts/owner/12345678-1234-4234-8234-123456789012.m4a')
  expect(FS.writeFile).not.toHaveBeenCalled()
})

it.each(['meeting', 'note'] as const)('rejects new %s video before any retained copy or metadata and releases picker cache', async purpose => {
  NativeModules.MeetingFiles.pickFile.mockResolvedValue({ uri: 'content://picked/video', name: 'sample.mp4' })
  await expect(importLocalFile({ purpose, expectedOwner: 'owner' })).rejects.toThrow('视频')
  expect(FS.copyFile).not.toHaveBeenCalled()
  expect(FS.writeFile).not.toHaveBeenCalled()
  expect(importRecording).not.toHaveBeenCalled()
  expect(NativeModules.MeetingFiles.releaseAudio).toHaveBeenCalledWith('content://picked/video')
})

it.each(['pdf', 'docx', 'aac'])('retains supported note %s imports', async extension => {
  NativeModules.MeetingFiles.pickFile.mockResolvedValue({ uri: 'content://picked/file', name: `sample.${extension}` })
  expect(await importLocalFile({ purpose: 'note', expectedOwner: 'owner' })).toMatchObject({ extension, purpose: 'note' })
  expect(FS.copyFile).toHaveBeenCalled()
})

it('explicit meeting audio retains the recording detail workflow', async () => {
  jest.mocked(importRecording).mockResolvedValue({ id: 'recording' } as never)
  expect(await importLocalFile({ purpose: 'meeting', expectedOwner: 'owner' })).toEqual({ id: 'recording' })
  expect(importRecording).toHaveBeenCalled()
})

const legacy = { id: '12345678-1234-4234-8234-123456789012', name: 'old.mp4', uri: 'file:///documents/files/accounts/owner/12345678-1234-4234-8234-123456789012.mp4', extension: 'mp4', size: 2000, category: 'video' as const, createdAt: '2026-10-12' }
const root = '/documents/files/accounts/owner'
it('legacy assignment persists separately and list readback merges it without moving the original or altering task relations', async () => {
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(legacy))
  expect(await setLocalFilePurpose(legacy, 'meeting', 'owner')).toEqual({ ...legacy, purpose: 'meeting' })
  expect(FS.writeFile).toHaveBeenCalledWith(expect.stringContaining('.purpose.json.'), JSON.stringify({ owner: 'owner', fileId: legacy.id, purpose: 'meeting' }), 'utf8')
  expect(FS.copyFile).not.toHaveBeenCalled()
  expect(FS.unlink).not.toHaveBeenCalledWith(legacy.uri)
  expect(FS.writeFile).not.toHaveBeenCalledWith(`${root}/${legacy.id}.meta.json`, expect.anything(), expect.anything())
  jest.mocked(FS.exists).mockResolvedValue(true)
  jest.mocked(FS.readDir).mockResolvedValue([{ name: `${legacy.id}.meta.json`, path: `${root}/${legacy.id}.meta.json` }] as never)
  jest.mocked(FS.readFile).mockResolvedValueOnce(JSON.stringify(legacy)).mockResolvedValueOnce(JSON.stringify({ owner: 'owner', fileId: legacy.id, purpose: 'meeting' }))
  expect(await listLocalFiles('owner')).toEqual([{ ...legacy, purpose: 'meeting' }])
})

it('legacy files with no placement retain unknown purpose instead of guessing video is meeting', async () => {
  jest.mocked(FS.exists).mockImplementation(async path => path === root)
  jest.mocked(FS.readDir).mockResolvedValue([{ name: `${legacy.id}.meta.json`, path: `${root}/${legacy.id}.meta.json` }] as never)
  jest.mocked(FS.readFile).mockResolvedValue(JSON.stringify(legacy))
  expect(await listLocalFiles('owner')).toEqual([legacy])
})

it('account change during legacy metadata read prevents purpose writes and preserves the original', async () => {
  jest.mocked(FS.readFile).mockImplementation(async () => { jest.mocked(readAccountId).mockResolvedValue('other'); return JSON.stringify(legacy) })
  await expect(setLocalFilePurpose(legacy, 'note', 'owner')).rejects.toThrow('账号已切换')
  expect(FS.writeFile).not.toHaveBeenCalled()
  expect(FS.unlink).not.toHaveBeenCalled()
})

it('cross-owner placement is rejected, never displayed as the current account material', async () => {
  jest.mocked(FS.exists).mockResolvedValue(true)
  jest.mocked(FS.readDir).mockResolvedValue([{ name: `${legacy.id}.meta.json`, path: `${root}/${legacy.id}.meta.json` }] as never)
  jest.mocked(FS.readFile).mockResolvedValueOnce(JSON.stringify(legacy)).mockResolvedValueOnce(JSON.stringify({ owner: 'other', fileId: legacy.id, purpose: 'meeting' }))
  await expect(listLocalFiles('owner')).rejects.toThrow('未核验')
})
