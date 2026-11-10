import FS from 'react-native-fs'
import { submitMeetingFile } from './meetingFileApi'
import type { MeetingFileJob } from './meetingFileJobState'
import type { MeetingFileBinding } from './meetingFileWorkflow'

/** Recheck the exact normalized file before the one permitted submit. */
export async function verifyMeetingFile(binding: MeetingFileBinding, uri: string, guard: () => Promise<void>, owner?: string) {
  const path = uri.startsWith('file://') ? uri.slice(7) : ''
  const prefix = `${FS.CachesDirectoryPath}/asr-`
  if (binding.audioFormat === 'm4a') {
    const roots = ['recordings'].map(folder => `${FS.DocumentDirectoryPath}/${folder}/accounts/${encodeURIComponent(owner || '')}/`)
    if (!owner || binding.originalSha256 !== binding.wavSha256 || !roots.some(root => path.startsWith(root) && /^[a-z0-9-]+\.m4a$/i.test(path.slice(root.length)))) throw new Error('会议原音频路径无效')
  } else if (!path.startsWith(prefix) || !/^[a-f0-9-]+\.wav$/i.test(path.slice(prefix.length))) throw new Error('会议音频缓存路径无效')
  await guard()
  if (Number((await FS.stat(path)).size) !== binding.wavBytes || await FS.hash(path, 'sha256') !== binding.wavSha256) throw new Error('会议音频缓存已变化，未提交')
  await guard()
}

export async function submitVerifiedMeetingFile(job: MeetingFileJob, binding: MeetingFileBinding, uri: string, guard: () => Promise<void>, progress?: (percent: number) => void) {
  await verifyMeetingFile(binding, uri, guard, job.owner)
  return submitMeetingFile(job, uri, progress)
}
