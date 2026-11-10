export type MeetingJobPhase = 'created' | 'submitted' | 'result' | 'failed' | 'unknown'
export type MeetingFileJob = { id: string; model: string; owner: string; phase: MeetingJobPhase }
export type MeetingJobAction = 'submit' | 'query' | 'result' | 'stop'

export function initialMeetingJob(id: string, model: string, owner: string): MeetingFileJob {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || !model.trim() || !owner.trim()) {
    throw new Error('会议转写任务身份无效')
  }
  return { id, model, owner, phase: 'created' }
}

export function meetingJobAction(job: MeetingFileJob): MeetingJobAction {
  if (job.phase === 'created') return 'submit'
  if (job.phase === 'submitted') return 'query'
  if (job.phase === 'result') return 'result'
  return 'stop'
}

/** A network result can advance only the same, durably recorded attempt. */
export function acceptMeetingJob(job: MeetingFileJob, response: { id?: unknown; status?: unknown }): MeetingFileJob {
  if (job.phase !== 'submitted' || response.id !== job.id) throw new Error('会议转写任务身份不一致')
  switch (response.status) {
    case 'queued': case 'submitting': case 'processing': return job
    case 'completed': return { ...job, phase: 'result' }
    case 'failed': return { ...job, phase: 'failed' }
    case 'outcome_unknown': return { ...job, phase: 'unknown' }
    default: throw new Error('会议转写服务返回未知状态')
  }
}
