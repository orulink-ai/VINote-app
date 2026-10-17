import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native'
import { readAccountId } from './storage'
import { identityEpoch, subscribeIdentity } from './sessionIdentity'
import { operationId } from './integration'
import { registerBilibiliFile } from './localFiles'
import type { LocalFile } from './localFiles'
import type { BilibiliSource } from '../types/bilibili'

const maximum = 128 * 1024 * 1024
const native = () => NativeModules.MeetingFiles
export function deviceBilibiliAvailable() {
  return Platform.OS === 'android' && native()?.bilibiliDownloadProtocol === 1 && typeof native()?.startBilibiliDownload === 'function' && typeof native()?.cancelBilibiliDownload === 'function' && typeof native()?.releaseBilibiliDownload === 'function'
}
export type BilibiliProgress = { bytes: number; total: number | null }
let active = false
export function downloadBilibiliAudio(owner: string, url: string, byteBudget = maximum, progress: (value: BilibiliProgress) => void = () => {}) {
  if (!deviceBilibiliAvailable()) throw new Error(Platform.OS === 'ios' ? 'iOS 暂不支持从 B站保存音频，请导入文件。' : '从 B站保存音频需要更新 App 安装包。')
  if (AppState.currentState !== 'active') throw new Error('请保持 App 在前台再保存音频。')
  if (active) throw new Error('请等待当前设备下载结束')
  if (!Number.isSafeInteger(byteBudget) || byteBudget <= 0) throw new Error('文件上限无效，未开始下载')
  active = true
  const id = operationId(), epoch = identityEpoch(), module = native(), limit = Math.min(maximum, byteBudget)
  let cancelled = false, finished = false
  const cancel = () => { if (!finished) { cancelled = true; void module.cancelBilibiliDownload(id).catch(() => {}) } }
  const guard = async () => {
    if (cancelled || identityEpoch() !== epoch || await readAccountId() !== owner || cancelled || identityEpoch() !== epoch) throw new Error('下载已停止或账号已变化，未提交生成')
  }
  const unsubscribe = subscribeIdentity(cancel)
  const background = AppState.addEventListener('change', state => { if (state !== 'active') cancel() })
  const events = new NativeEventEmitter(module).addListener('VINoteBilibiliDownload', payload => {
    const value = payload as { id?: unknown; owner?: unknown; bytes: number; total: number }
    if (cancelled || value.id !== id || value.owner !== owner || identityEpoch() !== epoch) return
    if (Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= limit) {
      try { progress({ bytes: value.bytes, total: Number.isSafeInteger(value.total) && value.total > 0 && value.total <= limit ? value.total : null }) } catch { /* A UI observer cannot own native cleanup. */ }
    }
  })
  const promise: Promise<LocalFile> = (async () => {
    try {
      await guard()
      const result = await module.startBilibiliDownload(id, owner, url, limit)
      await guard()
      if (result.originalUrl !== url || !/^BV[a-zA-Z0-9]{10}$/.test(result.bvid) || !Number.isInteger(result.page) || result.page < 1 || result.page > 9999 ||
        result.canonicalUrl !== `https://www.bilibili.com/video/${result.bvid}?p=${result.page}` || !/^[1-9][0-9]*$/.test(result.aid) || !/^[1-9][0-9]*$/.test(result.cid) ||
        !Number.isFinite(result.duration) || result.duration <= 0 || !Number.isSafeInteger(result.size) || result.size <= 0 || result.size > limit || typeof result.title !== 'string' || !result.title.trim()) throw new Error('下载来源或文件信息无法核验，未提交生成')
      const source: BilibiliSource = { platform: 'bilibili', operationId: id, originalUrl: url, canonicalUrl: result.canonicalUrl, bvid: result.bvid, page: result.page, aid: result.aid, cid: result.cid, duration: result.duration }
      return await registerBilibiliFile(owner, id, result.uri, result.title.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 300), result.size, source, guard)
    } finally {
      finished = true; unsubscribe(); background.remove(); events.remove()
      try { await module.releaseBilibiliDownload(id) } finally { active = false }
    }
  })()
  return { id, promise, cancel }
}
