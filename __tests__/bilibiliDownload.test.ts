import { AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native'
import { deviceBilibiliAvailable, downloadBilibiliAudio } from '../src/lib/bilibiliDownload'
import { registerBilibiliFile } from '../src/lib/localFiles'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/integration', () => ({ operationId: () => '12345678-1234-4234-8234-123456789012' }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/localFiles', () => ({ registerBilibiliFile: jest.fn() }))
const id = '12345678-1234-4234-8234-123456789012', url = 'https://www.bilibili.com/video/BV1234567890?p=2'
const result = { uri: `/cache/bilibili-${id}.m4a`, title: '测试音频', size: 1024, originalUrl: url, canonicalUrl: url, bvid: 'BV1234567890', page: 2, aid: '123', cid: '456', duration: 40 }
const os = Platform.OS
beforeEach(() => {
  jest.clearAllMocks(); transitionIdentity('alice')
  AppState.currentState = 'active'
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  jest.mocked(readAccountId).mockResolvedValue('alice')
  NativeModules.MeetingFiles = { bilibiliDownloadProtocol: 1, addListener: jest.fn(), removeListeners: jest.fn(), startBilibiliDownload: jest.fn(async () => result), cancelBilibiliDownload: jest.fn(async () => {}), releaseBilibiliDownload: jest.fn(async () => {}) }
  jest.mocked(registerBilibiliFile).mockImplementation(async (owner, fileId, uri, title, size, source, guard) => {
    await guard()
    return { id: fileId, uri, name: title + '.m4a', size, extension: 'm4a', category: 'audio', createdAt: '2026-10-17', purpose: 'note', source: 'bilibili', bilibiliSource: source }
  })
})
afterEach(() => { Object.defineProperty(Platform, 'OS', { configurable: true, value: os }) })
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
test('only the explicit native download is invoked; owner source and stable operation register as note audio', async () => {
  const task = downloadBilibiliAudio('alice', url, 2048)
  const file = await task.promise
  expect(NativeModules.MeetingFiles.startBilibiliDownload).toHaveBeenCalledWith(id, 'alice', url, 2048)
  expect(file).toMatchObject({ purpose: 'note', source: 'bilibili', bilibiliSource: { originalUrl: url, bvid: 'BV1234567890', page: 2, operationId: id } })
  expect(NativeModules.MeetingFiles.releaseBilibiliDownload).toHaveBeenCalledWith(id)
})
test.each(['cancel', 'account'])('late native success after %s cannot register a file for another identity', async reason => {
  let finish!: (value: typeof result) => void
  NativeModules.MeetingFiles.startBilibiliDownload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const task = downloadBilibiliAudio('alice', url)
  const rejected = expect(task.promise).rejects.toThrow('下载已停止或账号已变化')
  await flush()
  if (reason === 'account') { jest.mocked(readAccountId).mockResolvedValue('bob'); transitionIdentity('bob') } else task.cancel()
  finish(result)
  await rejected
  expect(registerBilibiliFile).not.toHaveBeenCalled()
  expect(NativeModules.MeetingFiles.cancelBilibiliDownload).toHaveBeenCalledWith(id)
  expect(NativeModules.MeetingFiles.releaseBilibiliDownload).toHaveBeenCalledWith(id)
})
test('invalid or oversized native result never registers and always cleans cache', async () => {
  NativeModules.MeetingFiles.startBilibiliDownload.mockResolvedValueOnce({ ...result, size: 4096 })
  await expect(downloadBilibiliAudio('alice', url, 2048).promise).rejects.toThrow('无法核验')
  expect(registerBilibiliFile).not.toHaveBeenCalled()
  expect(NativeModules.MeetingFiles.releaseBilibiliDownload).toHaveBeenCalledWith(id)
})
test('progress is bound to job and owner; a second download cannot overlap', async () => {
  let finish!: (value: typeof result) => void
  NativeModules.MeetingFiles.startBilibiliDownload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const progress = jest.fn(), task = downloadBilibiliAudio('alice', url, 2048, progress)
  await flush()
  expect(() => downloadBilibiliAudio('alice', url)).toThrow('等待')
  DeviceEventEmitter.emit('VINoteBilibiliDownload', { id: 'other', owner: 'alice', bytes: 1, total: 2 })
  DeviceEventEmitter.emit('VINoteBilibiliDownload', { id, owner: 'bob', bytes: 1, total: 2 })
  expect(progress).not.toHaveBeenCalled()
  DeviceEventEmitter.emit('VINoteBilibiliDownload', { id, owner: 'alice', bytes: 512, total: 1024 })
  expect(progress).toHaveBeenCalledWith({ bytes: 512, total: 1024 })
  finish(result); await task.promise
})
test('iOS and old Android bridge are explicitly unavailable', () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' })
  expect(deviceBilibiliAvailable()).toBe(false)
  expect(() => downloadBilibiliAudio('alice', url)).toThrow('iOS')
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  delete NativeModules.MeetingFiles.bilibiliDownloadProtocol
  expect(() => downloadBilibiliAudio('alice', url)).toThrow('更新')
  expect(NativeModules.MeetingFiles.startBilibiliDownload).not.toHaveBeenCalled()
})

test('backgrounding cancels the native job and cannot register a late result', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener')
  let finish!: (value: typeof result) => void
  NativeModules.MeetingFiles.startBilibiliDownload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const task = downloadBilibiliAudio('alice', url)
  const rejected = expect(task.promise).rejects.toThrow('下载已停止或账号已变化')
  await flush()
  const onChange = listener.mock.calls[0][1] as (state: string) => void
  onChange('background')
  listener.mockRestore()
  finish(result)
  await rejected
  expect(NativeModules.MeetingFiles.cancelBilibiliDownload).toHaveBeenCalledWith(id)
  expect(registerBilibiliFile).not.toHaveBeenCalled()
})
