import FS from 'react-native-fs'
import { verifyApkHash, type ApkUpdateAsset } from './apkUpdatePolicy'

let active = false
const MAX_APK_BYTES = 1024 * 1024 * 1024

/** Download to an app-owned cache, verify it fully, and return only the verified path. */
export function downloadApkUpdate(asset: ApkUpdateAsset, onProgress?: (written: number, total: number) => void) {
  if (active) throw new Error('已有更新正在下载')
  if (!/^https:\/\/github\.com\/vilab-orulink\/Vinote-app-public\/releases\/download\/v?\d+\.\d+\.\d+\/[a-z0-9._-]+\.apk$/i.test(asset.url) ||
      (asset.apiUrl !== undefined && !/^https:\/\/api\.github\.com\/repos\/vilab-orulink\/Vinote-app-public\/releases\/assets\/[1-9]\d*$/.test(asset.apiUrl)) ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_APK_BYTES || !/^[a-f0-9]{64}$/i.test(asset.sha256)) throw new Error('更新包信息无效')
  active = true
  let cancelled = false, jobId: number | undefined
  const folder = `${FS.CachesDirectoryPath}/vinote-updates`, path = `${folder}/update.apk`
  const check = () => { if (cancelled) throw new Error('已取消下载') }
  const promise = (async () => {
    try {
      await FS.mkdir(folder); check()
      const job = FS.downloadFile({ fromUrl: asset.apiUrl || asset.url, toFile: path, progressInterval: 500,
        ...(asset.apiUrl ? { headers: { Accept: 'application/octet-stream' } } : {}),
        progress: value => { if (!cancelled && value.bytesWritten >= 0) onProgress?.(Math.min(value.bytesWritten, asset.bytes), asset.bytes) } })
      jobId = job.jobId
      const response = await job.promise; check()
      if (response.statusCode !== 200 || response.bytesWritten !== asset.bytes) throw new Error('更新包下载不完整')
      const stat = await FS.stat(path); check()
      if (Number(stat.size) !== asset.bytes) throw new Error('更新包大小不匹配')
      const hash = await FS.hash(path, 'sha256'); check()
      if (!verifyApkHash(asset.sha256, hash)) throw new Error('更新包校验失败')
      return path
    } catch (error) {
      if (await FS.exists(path).catch(() => false)) await FS.unlink(path).catch(() => {})
      throw error
    } finally { active = false }
  })()
  return { promise, cancel: () => { cancelled = true; if (jobId !== undefined) FS.stopDownload(jobId) } }
}
