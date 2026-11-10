import FS from 'react-native-fs'
import { downloadApkUpdate } from '../src/lib/downloadApkUpdate'
jest.mock('react-native-fs', () => ({ CachesDirectoryPath: '/cache', mkdir: jest.fn(async () => {}), exists: jest.fn(async () => true), unlink: jest.fn(async () => {}), hash: jest.fn(async () => 'a'.repeat(64)), stat: jest.fn(async () => ({ size: 12345 })), downloadFile: jest.fn(() => ({ jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 12345 }) })), stopDownload: jest.fn() }))
const asset = { url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/download/v0.1.5/VINote_0.1.5.apk', bytes: 12345, sha256: 'a'.repeat(64) }
beforeEach(() => jest.clearAllMocks())
test('downloads only into the dedicated cache and returns after verifying length and digest', async () => {
  const operation = downloadApkUpdate(asset)
  const path = await operation.promise
  expect(path).toBe('/cache/vinote-updates/update.apk')
  expect(FS.hash).toHaveBeenCalledWith(path, 'sha256')
  expect(FS.downloadFile).toHaveBeenCalledWith(expect.objectContaining({ fromUrl: asset.url, toFile: path }))
})
test('uses the official asset API when the release metadata contains an asset ID', async () => {
  await downloadApkUpdate({ ...asset, apiUrl: 'https://api.github.com/repos/vilab-orulink/Vinote-app-public/releases/assets/12345' }).promise
  expect(FS.downloadFile).toHaveBeenCalledWith(expect.objectContaining({ fromUrl: 'https://api.github.com/repos/vilab-orulink/Vinote-app-public/releases/assets/12345', headers: expect.objectContaining({ Accept: 'application/octet-stream' }) }))
})
test('rejects an asset API URL outside the official repository', () => {
  expect(() => downloadApkUpdate({ ...asset, apiUrl: 'https://evil.example/12345' })).toThrow()
})
test('removes a mismatched download and does not return it for installation', async () => {
  ;(FS.hash as jest.Mock).mockResolvedValueOnce('b'.repeat(64))
  await expect(downloadApkUpdate(asset).promise).rejects.toThrow()
  expect(FS.unlink).toHaveBeenCalledWith('/cache/vinote-updates/update.apk')
})
test('cancel uses the native download id', async () => {
  const operation = downloadApkUpdate(asset)
  await Promise.resolve(); await Promise.resolve()
  operation.cancel()
  expect(FS.stopDownload).toHaveBeenCalledWith(1)
  await expect(operation.promise).rejects.toThrow()
})
