import FS from 'react-native-fs'
import { readMeetingFileJob, readMeetingFileResult } from './meetingFileApi'
import { runMeetingFile } from './meetingFileRun'
import { submitVerifiedMeetingFile, verifyMeetingFile } from './meetingFileUpload'
import type { MeetingFileCheckpoint } from './meetingFileWorkflow'
import type { MeetingJobPhase } from './meetingFileJobState'

type Prepared = { checkpoint: MeetingFileCheckpoint; wavUri: string }
type Options = {
  owner: string; model: string; providerModel: string; origin: string; sourceUri: string
  guard: () => Promise<void>; save: (checkpoint: MeetingFileCheckpoint) => Promise<void>
  wait: () => Promise<void>; progress: (phase: MeetingJobPhase) => void
  uploadProgress?: (percent: number) => void
}

/** Drive one existing job; recheck source and identity before submit or read. */
export async function runPreparedMeetingFile(prepared: Prepared, options: Options): Promise<MeetingFileCheckpoint> {
  const checkpoint = prepared.checkpoint, binding = checkpoint.binding
  const legacyOrigin = binding.origin === 'https://api.orulink.ai' && options.origin === 'https://api-hk.orulink.ai' && checkpoint.job.phase !== 'created' ? binding.origin : undefined
  if (!options.owner || checkpoint.job.owner !== options.owner || checkpoint.job.model !== options.model ||
      (binding.origin !== options.origin && !legacyOrigin) || binding.providerModel !== options.providerModel) throw new Error('账号、模型或服务已变化，原任务保留')
  const path = options.sourceUri.startsWith('file://') ? options.sourceUri.slice(7) : ''
  const roots = ['recordings', 'files'].map(folder => `${FS.DocumentDirectoryPath}/${folder}/accounts/${encodeURIComponent(options.owner)}/`)
  if (!roots.some(root => path.startsWith(root) && /^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(path.slice(root.length)))) throw new Error('会议原音频不属于当前账号')
  await options.guard()
  const originalSha256 = await FS.hash(path, 'sha256')
  await options.guard()
  const current = { ...binding, providerModel: options.providerModel, originalSha256 }
  return runMeetingFile(checkpoint, current, {
    guard: options.guard, save: options.save, wait: options.wait, progress: options.progress,
    preflight: () => verifyMeetingFile(binding, prepared.wavUri, options.guard, options.owner),
    submit: job => submitVerifiedMeetingFile(job, binding, prepared.wavUri, options.guard, options.uploadProgress),
    query: job => readMeetingFileJob(job, legacyOrigin), result: job => readMeetingFileResult(job, legacyOrigin),
  })
}
