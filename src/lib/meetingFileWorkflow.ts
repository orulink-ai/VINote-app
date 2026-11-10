import { dispatchMeetingFileJob, queryMeetingFileJob } from './meetingFileJob'
import { meetingJobAction, type MeetingFileJob } from './meetingFileJobState'
import { parseMeetingFileResult, type MeetingFileResult } from './meetingFileResult'

export type MeetingFileBinding = { origin: string; providerModel: string; originalSha256: string; wavSha256: string; wavBytes: number; duration: number; audioFormat?: 'm4a' }
export type MeetingFileCheckpoint = { version: 1; job: MeetingFileJob; binding: MeetingFileBinding; result?: MeetingFileResult }
type Snapshot = { id?: unknown; status?: unknown }
type Operations = {
  guard: () => Promise<void>
  preflight?: () => Promise<void>
  save: (checkpoint: MeetingFileCheckpoint) => Promise<void>
  submit: (job: MeetingFileJob) => Promise<Snapshot>
  query: (job: MeetingFileJob) => Promise<Snapshot>
  result: (job: MeetingFileJob) => Promise<unknown>
}

function validBinding(value: MeetingFileBinding) {
  if (!value || typeof value.origin !== 'string' || !/^https?:\/\/[a-z0-9.:-]+$/i.test(value.origin) || typeof value.providerModel !== 'string' || !value.providerModel.trim() ||
      !/^[a-f0-9]{64}$/i.test(value.originalSha256) || !/^[a-f0-9]{64}$/i.test(value.wavSha256) ||
      !Number.isSafeInteger(value.wavBytes) || value.wavBytes <= 0 || !Number.isFinite(value.duration) || value.duration <= 0 ||
      (value.audioFormat !== undefined && value.audioFormat !== 'm4a')) return false
  return true
}

/** One advancement only: the caller controls polling and stores the original source binding. */
export async function advanceMeetingFile(checkpoint: MeetingFileCheckpoint, current: MeetingFileBinding, ops: Operations): Promise<MeetingFileCheckpoint> {
  const original = checkpoint?.binding
  if (checkpoint?.version !== 1 || !validBinding(original) || !validBinding(current) ||
      original.origin !== current.origin || original.providerModel !== current.providerModel || original.originalSha256 !== current.originalSha256 ||
      original.wavSha256 !== current.wavSha256 || original.wavBytes !== current.wavBytes || original.duration !== current.duration || original.audioFormat !== current.audioFormat) {
    throw new Error('会议音频或服务已变化，原任务已保留')
  }
  await ops.guard()
  if (checkpoint.result) {
    parseMeetingFileResult(checkpoint.job, { ...checkpoint.result, id: checkpoint.job.id, model: current.providerModel }, current.duration, current.providerModel)
    return checkpoint
  }
  let next = checkpoint
  const saveJob = async (job: MeetingFileJob) => { next = { ...next, job }; await ops.save(next) }
  const action = meetingJobAction(next.job)
  if (action === 'submit') await dispatchMeetingFileJob(next.job, { ...ops, save: saveJob })
  else if (action === 'query') await queryMeetingFileJob(next.job, { ...ops, save: saveJob })
  else if (action === 'stop') return next
  if (meetingJobAction(next.job) === 'result') {
    await ops.guard()
    const raw = await ops.result(next.job)
    await ops.guard()
    const result = parseMeetingFileResult(next.job, raw, current.duration, current.providerModel)
    next = { ...next, result }
    await ops.save(next)
    await ops.guard()
  }
  return next
}
