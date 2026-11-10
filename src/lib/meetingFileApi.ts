import { apiJson, meetingUploadJson, readLegacyMeetingJson } from './api'
import { ApiError } from './errors'
import { initialMeetingJob, type MeetingFileJob } from './meetingFileJobState'

type Snapshot = { id?: unknown; status?: unknown }

function jobPath(job: MeetingFileJob) {
  initialMeetingJob(job.id, job.model, job.owner)
  return `/v1/asr/transcription-jobs/${job.id}`
}

/** RN sends the native file URI as multipart; audio bytes are never read into JS. */
export async function submitMeetingFile(job: MeetingFileJob, uri: string, progress?: (percent: number) => void): Promise<Snapshot> {
  jobPath(job)
  if (job.phase !== 'submitted' || !/^file:\/\/\/[^?#]+\.(wav|m4a)$/i.test(uri) || uri.includes('..')) {
    throw new Error('会议音频或任务状态无效，未提交')
  }
  const form = new FormData()
  form.append('mode', 'meeting')
  form.append('model', job.model)
  const compressed = /\.m4a$/i.test(uri)
  form.append('file', { uri, name: compressed ? 'meeting.m4a' : 'meeting.wav', type: compressed ? 'audio/mp4' : 'audio/wav' } as unknown as Blob)
  try {
    return await meetingUploadJson<Snapshot>('/v1/asr/transcription-jobs', {
      method: 'POST', headers: { 'Idempotency-Key': job.id }, body: form,
    }, job.owner, 7200000, progress)
  } catch (error) {
    if (error instanceof ApiError && error.status === 413) {
      throw new ApiError('录音超过服务入口的上传大小限制，原录音已保留。请联系管理员处理后再核验原任务。', error.status, error.details)
    }
    throw error
  }
}

export async function readMeetingFileJob(job: MeetingFileJob, legacyOrigin?: string): Promise<Snapshot> {
  if (job.phase !== 'submitted') throw new Error('会议任务当前不可查询')
  if (legacyOrigin && legacyOrigin !== 'https://api.orulink.ai') throw new Error('服务地址不受信任')
  try { return legacyOrigin ? await readLegacyMeetingJson<Snapshot>(jobPath(job), job.owner) : await apiJson<Snapshot>(jobPath(job), {}, job.owner) }
  catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.details?.code === 'transcription_job_not_found') {
      throw new ApiError('服务端未找到原转写任务，录音已保留；请检查上传连接后处理。', error.status, error.details)
    }
    throw error
  }
}

export async function readMeetingFileResult(job: MeetingFileJob, legacyOrigin?: string): Promise<unknown> {
  if (job.phase !== 'result') throw new Error('会议转写尚未完成')
  if (legacyOrigin && legacyOrigin !== 'https://api.orulink.ai') throw new Error('服务地址不受信任')
  return legacyOrigin ? readLegacyMeetingJson<unknown>(`${jobPath(job)}/result`, job.owner) : apiJson<unknown>(`${jobPath(job)}/result`, {}, job.owner)
}
