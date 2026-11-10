import { acceptMeetingJob, meetingJobAction, type MeetingFileJob } from './meetingFileJobState'

type Snapshot = { id?: unknown; status?: unknown }
type Common = { guard: () => Promise<void>; save: (job: MeetingFileJob) => Promise<void> }

/** Persist the original id before the only upload. A lost response is recovered by query. */
export async function dispatchMeetingFileJob(job: MeetingFileJob, ops: Common & { submit: (job: MeetingFileJob) => Promise<Snapshot>; preflight?: () => Promise<void> }) {
  if (meetingJobAction(job) !== 'submit') throw new Error('会议音频已经提交，不能重复上传')
  await ops.guard()
  await ops.preflight?.()
  await ops.guard()
  const submitted: MeetingFileJob = { ...job, phase: 'submitted' }
  await ops.save(submitted)
  await ops.guard()
  const response = await ops.submit(submitted)
  await ops.guard()
  const next = acceptMeetingJob(submitted, response)
  await ops.save(next)
  await ops.guard()
  return next
}

/** Recovery reads the existing task; it never uploads audio. */
export async function queryMeetingFileJob(job: MeetingFileJob, ops: Common & { query: (job: MeetingFileJob) => Promise<Snapshot> }) {
  if (meetingJobAction(job) !== 'query') throw new Error('会议转写任务不处于可查询状态')
  await ops.guard()
  const response = await ops.query(job)
  await ops.guard()
  const next = acceptMeetingJob(job, response)
  await ops.save(next)
  await ops.guard()
  return next
}
