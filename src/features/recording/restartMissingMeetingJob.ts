import { API_BASE_URL } from '../../config/env'
import { ApiError } from '../../lib/errors'
import { readMeetingFileJob } from '../../lib/meetingFileApi'
import { identityEpoch, SessionScopeChangedError } from '../../lib/sessionIdentity'
import { readAccountId } from '../../lib/storage'
import { listRecordings, saveRecording } from './recordingLibrary'
import { acquireRecordingLock } from './recordingProcessing'

/** Explicitly start over only after rechecking the original job; keep its identity for audit. */
export async function restartMissingMeetingJob(recordId: string) {
  const owner = await readAccountId(), epoch = identityEpoch()
  if (!owner) throw new SessionScopeChangedError()
  const release = acquireRecordingLock(owner, recordId)
  const guard = async () => { if (identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new SessionScopeChangedError() }
  try {
    const record = (await listRecordings()).find(item => item.id === recordId)
    const prepared = record?.meetingFilePrepared, job = prepared?.checkpoint.job
    if (!record || !prepared || !job || job.owner !== owner || job.phase !== 'submitted' || !record.generation || record.generation.asrModel !== job.model || record.errorDetails?.status !== 404 || record.errorDetails.code !== 'transcription_job_not_found') throw new Error('原任务状态已变化，请重新查看')
    const origin = prepared.checkpoint.binding.origin
    const current = API_BASE_URL.replace(/\/+$/, '')
    const legacy = current === 'https://api-hk.orulink.ai' && origin === 'https://api.orulink.ai' ? origin : undefined
    if (origin !== current && !legacy) throw new Error('原任务服务地址不可用')
    await guard()
    try { await readMeetingFileJob(job, legacy) }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404 || error.details?.code !== 'transcription_job_not_found') throw error
      await guard()
      return await saveRecording({ ...record, meetingFilePrepared: undefined, previousMeetingFileAttempts: [...(record.previousMeetingFileAttempts || []), prepared], error: undefined, errorDetails: undefined, generation: { ...record.generation, status: 'paused' } })
    }
    throw new Error('原任务已经存在，请继续查看原任务，未重新上传')
  } finally { release() }
}
