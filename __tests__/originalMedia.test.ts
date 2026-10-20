import { NativeModules, Platform } from 'react-native'
import Share from 'react-native-share'
import FS from 'react-native-fs'
import { exportOriginal } from '../src/lib/originalMedia'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
const media = { id: '11111111-1111-4111-8111-111111111111', name: 'original.m4a', extension: 'm4a', size: 123,
  uri: 'file:///documents/files/accounts/alice/11111111-1111-4111-8111-111111111111.m4a' }
beforeEach(() => {
  jest.clearAllMocks(); transitionIdentity('alice')
  jest.replaceProperty(Platform, 'OS', 'android')
  jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(FS.exists).mockResolvedValue(true)
  jest.mocked(FS.stat).mockResolvedValue({ size: 123 } as never)
  NativeModules.MeetingFiles = { originalMediaProtocol: 1, exportOriginal: jest.fn(async () => 'saved'), cancelOriginalExport: jest.fn() }
})
test('export uses original URI and resolves cancellation separately from saved; never reads bytes into JS', async () => {
  await expect(exportOriginal(media)).resolves.toBe('saved')
  expect(NativeModules.MeetingFiles.exportOriginal).toHaveBeenCalledWith(media.uri, media.name, 'alice')
  NativeModules.MeetingFiles.exportOriginal.mockResolvedValue('cancelled')
  await expect(exportOriginal(media)).resolves.toBe('cancelled')
  expect(FS.readFile).not.toHaveBeenCalled()
})
test('owner change during stat and uncontained paths cannot open an export picker', async () => {
  jest.mocked(FS.stat).mockImplementationOnce(async () => { transitionIdentity('bob'); return { size: 123 } as never })
  await expect(exportOriginal(media)).rejects.toThrow()
  await expect(exportOriginal({ ...media, uri: 'https://remote.invalid/audio.m4a' })).rejects.toThrow()
  expect(NativeModules.MeetingFiles.exportOriginal).not.toHaveBeenCalled()
})
test('reserved owner path segments cannot escape into a parent directory on either platform', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  jest.mocked(readAccountId).mockResolvedValue('..')
  await expect(exportOriginal({ ...media, uri: media.uri.replace('/alice/', '/../') })).rejects.toThrow('归属')
  expect(Share.open).not.toHaveBeenCalled()
})
test('old Android binaries fail visibly instead of claiming an export succeeded', async () => {
  delete NativeModules.MeetingFiles.originalMediaProtocol
  await expect(exportOriginal(media)).rejects.toThrow('安装包')
})

test.each(['android', 'ios'] as const)('legacy video cannot open a new %s export picker or delete old data', async platform => {
  jest.replaceProperty(Platform, 'OS', platform)
  await expect(exportOriginal({ ...media, extension: 'mp4', name: 'old.mp4' })).rejects.toThrow('视频')
  expect(NativeModules.MeetingFiles.exportOriginal).not.toHaveBeenCalled()
  expect(Share.open).not.toHaveBeenCalled()
  expect(FS.unlink).not.toHaveBeenCalled()
})

test.each(['pdf', 'docx'])('document %s uses the same owner-bound OS export', async extension => {
  const document = { ...media, name: `original.${extension}`, extension, uri: media.uri.replace(/m4a$/, extension) }
  await expect(exportOriginal(document)).resolves.toBe('saved')
  expect(NativeModules.MeetingFiles.exportOriginal).toHaveBeenCalledWith(document.uri, document.name, 'alice')
})

test('identity change still cancels the outstanding audio/document export', () => {
  transitionIdentity('bob')
  expect(NativeModules.MeetingFiles.cancelOriginalExport).toHaveBeenCalled()
})
test('iOS reuses the installed Share document picker with the full file URI and no NSData/base64 source', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  delete NativeModules.MeetingFiles.originalMediaProtocol
  jest.mocked(Share.open).mockResolvedValueOnce({ success: true, message: 'com.apple.DocumentsApp' })
  await expect(exportOriginal(media)).resolves.toBe('saved')
  expect(Share.open).toHaveBeenCalledWith({ url: media.uri, title: media.name, saveToFiles: true, failOnCancel: false })
  expect(NativeModules.MeetingFiles.exportOriginal).not.toHaveBeenCalled()
  expect(FS.readFile).not.toHaveBeenCalled()
  jest.mocked(Share.open).mockRejectedValueOnce({ code: 'CANCELLED' })
  await expect(exportOriginal(media)).resolves.toBe('cancelled')
})
