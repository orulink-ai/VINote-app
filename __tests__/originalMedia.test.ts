import { NativeModules, Platform } from 'react-native'
import Share from 'react-native-share'
import FS from 'react-native-fs'
import { exportOriginal, previewOriginal } from '../src/lib/originalMedia'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
const media = { id: '11111111-1111-4111-8111-111111111111', name: 'original.webm', extension: 'webm', size: 123,
  uri: 'file:///documents/files/accounts/alice/11111111-1111-4111-8111-111111111111.webm' }
beforeEach(() => {
  jest.clearAllMocks(); transitionIdentity('alice')
  jest.replaceProperty(Platform, 'OS', 'android')
  jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(FS.exists).mockResolvedValue(true)
  jest.mocked(FS.stat).mockResolvedValue({ size: 123 } as never)
  NativeModules.MeetingFiles = { originalMediaProtocol: 1, exportOriginal: jest.fn(async () => 'saved'), previewOriginal: jest.fn(async () => true) }
})
test('export uses original URI and resolves cancellation separately from saved; never reads bytes into JS', async () => {
  await expect(exportOriginal(media)).resolves.toBe('saved')
  expect(NativeModules.MeetingFiles.exportOriginal).toHaveBeenCalledWith(media.uri, media.name, 'alice')
  NativeModules.MeetingFiles.exportOriginal.mockResolvedValue('cancelled')
  await expect(exportOriginal(media)).resolves.toBe('cancelled')
  expect(FS.readFile).not.toHaveBeenCalled()
})
test('owner change during stat and uncontained paths cannot open a picker or player', async () => {
  jest.mocked(FS.stat).mockImplementationOnce(async () => { transitionIdentity('bob'); return { size: 123 } as never })
  await expect(exportOriginal(media)).rejects.toThrow()
  await expect(previewOriginal({ ...media, uri: 'https://remote.invalid/video.webm' })).rejects.toThrow()
  expect(NativeModules.MeetingFiles.exportOriginal).not.toHaveBeenCalled()
  expect(NativeModules.MeetingFiles.previewOriginal).not.toHaveBeenCalled()
})
test('reserved owner path segments cannot escape into a parent directory on either platform', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  jest.mocked(readAccountId).mockResolvedValue('..')
  await expect(exportOriginal({ ...media, uri: media.uri.replace('/alice/', '/../') })).rejects.toThrow('归属')
  expect(Share.open).not.toHaveBeenCalled()
})
test('video preview accepts only the original owner file and bounded seek, old binaries fail visibly', async () => {
  await previewOriginal(media, 90)
  expect(NativeModules.MeetingFiles.previewOriginal).toHaveBeenCalledWith(media.uri, 'alice', 90)
  await expect(previewOriginal(media, -1)).rejects.toThrow()
  delete NativeModules.MeetingFiles.originalMediaProtocol
  await expect(previewOriginal(media)).rejects.toThrow('安装包')
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
