import { NativeModules, Platform } from 'react-native'
import Share from 'react-native-share'
import FS from 'react-native-fs'
import { readAccountId } from './storage'
import { identityEpoch, subscribeIdentity } from './sessionIdentity'

subscribeIdentity(() => { closeOriginalPreview(); NativeModules.MeetingFiles?.cancelOriginalExport?.() })

type Original = { id: string; uri: string; name: string; extension: string; size?: number }
async function verified(file: Original) {
  const epoch = identityEpoch(), owner = await readAccountId()
  if (!owner || owner.length > 200 || ['.', '..'].includes(owner) || /[\u0000-\u001f]/.test(owner) || !/^[a-zA-Z0-9-]+$/.test(file.id) || !/^[a-z0-9]{1,8}$/.test(file.extension)) throw new Error('原文件归属未核验')
  const roots = ['files', 'recordings'].map(kind => `file://${FS.DocumentDirectoryPath}/${kind}/accounts/${encodeURIComponent(owner)}/${file.id}.${file.extension}`)
  if (!roots.includes(file.uri) || !await FS.exists(file.uri)) throw new Error('原文件在当前设备不可用，请返回文件库核对')
  const size = Number((await FS.stat(file.uri)).size)
  if (!Number.isSafeInteger(size) || size <= 0 || file.size !== undefined && size !== file.size) throw new Error('原文件已变化，请重新读取')
  if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请重新打开原文件')
  return { owner, epoch }
}
function requireNative() { if (NativeModules.MeetingFiles?.originalMediaProtocol !== 1) throw new Error('此功能需要更新 App 安装包；原文件保留') }
export async function exportOriginal(file: Original): Promise<'saved' | 'cancelled'> {
  const { owner, epoch } = await verified(file)
  if (Platform.OS === 'ios') {
    try {
      // Existing RNShare passes a file URL straight to UIDocumentPicker.
      // data: would allocate NSData; verified() only accepts account file URIs.
      const result = await Share.open({ url: file.uri, title: file.name, saveToFiles: true, failOnCancel: false })
      if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请核对原保存位置')
      if (result.success === true) return 'saved'
      if (result.dismissedAction === true || result.success === false) return 'cancelled'
      throw new Error('保存结果尚未确认，请核对所选位置；原文件保留')
    } catch (error) {
      if ((error as { code?: string })?.code === 'CANCELLED') return 'cancelled'
      throw error
    }
  }
  requireNative()
  const result = await NativeModules.MeetingFiles.exportOriginal(file.uri, file.name, owner)
  if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请核对原保存位置')
  if (result !== 'saved' && result !== 'cancelled') throw new Error('保存结果尚未确认，请核对所选位置；原文件保留')
  return result
}
export async function previewOriginal(file: Original, seconds = 0) {
  if (!['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(file.extension) || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new Error('视频或播放位置无效')
  const { owner } = await verified(file)
  requireNative()
  await NativeModules.MeetingFiles.previewOriginal(file.uri, owner, seconds)
}
export function closeOriginalPreview() { NativeModules.MeetingFiles?.closeOriginalPreview?.() }
