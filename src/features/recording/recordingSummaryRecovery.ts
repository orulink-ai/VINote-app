import FS from 'react-native-fs'
import { readAccountId } from '../../lib/storage'
import { identityEpoch } from '../../lib/sessionIdentity'
import { migrateIntervals } from '../../lib/meetingCloud'
import { recordingASRBlocked, RECORDING_ASR_BLOCKED } from '../../lib/recordingASRSafety'
import { listRecordings, type LocalRecording } from './recordingLibrary'
import { parseMeetingFileResult } from '../../lib/meetingFileResult'
import { initialMeetingJob } from '../../lib/meetingFileJobState'
import { API_BASE_URL } from '../../config/env'
import { meetingFileEvidence } from '../../lib/meetingFileEvidence'

export type SummaryRecoveryConfirmation = {
  owner: string; epoch: number; recordId: string; evidenceKey: string
  confirmed: true; llmModel: string
}
export type PreparedRecordingSummary = Omit<SummaryRecoveryConfirmation, 'confirmed' | 'llmModel'> & {
  record: LocalRecording; transcript: string; evidence?: string
}
const invalid = () => { throw new Error('完整转写与说话人结果尚不能核验，未重新转写或分析；原录音和进度保留') }

/** Read existing evidence only. Never invoke normalization, ASR or speaker inference. */
export async function prepareRecordingSummary(recordId: string): Promise<PreparedRecordingSummary> {
  const owner = await readAccountId(), epoch = identityEpoch()
  if (!owner) throw new Error('请重新登录')
  const record = (await listRecordings()).find(value => value.id === recordId)
  if (!record || !/^[a-zA-Z0-9-]+$/.test(recordId)) return invalid()
  const path = record.uri.replace(/^file:\/\//, '')
  const extension = record.extension || 'm4a'
  if (!['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg'].includes(extension) ||
      path !== `${FS.DocumentDirectoryPath}/recordings/accounts/${encodeURIComponent(owner)}/${recordId}.${extension}` ||
      record.state === 'recording' || record.state === 'interrupted') return invalid()
  if (recordingASRBlocked(record)) throw new Error(RECORDING_ASR_BLOCKED)
  const stat = await FS.stat(path)
  const source = { size: Number(stat.size), modifiedMs: new Date(stat.mtime).getTime() }
  const matches = (value?: { size: number; modifiedMs: number }) => value?.size === source.size && value.modifiedMs === source.modifiedMs
  if (!Number.isFinite(source.size) || source.size <= 0 || !Number.isFinite(source.modifiedMs)) return invalid()
  const asr = record.transcriptionCheckpoint, speaker = record.speakerCheckpoint
  const model = record.asrModel || record.generation?.asrModel
  if (!model || record.generation && record.generation.asrModel !== model || asr && record.meetingFilePrepared) return invalid()
  let duration: number, transcript: string, asrEvidence: unknown
  if (record.meetingFilePrepared) {
    const cp = record.meetingFilePrepared.checkpoint
    if (!cp || cp.version !== 1 || cp.job.owner !== owner || cp.job.model !== model || cp.job.phase !== 'result' ||
        (cp.binding.origin !== API_BASE_URL.replace(/\/+$/, '') && !(API_BASE_URL.replace(/\/+$/, '') === 'https://api-hk.orulink.ai' && cp.binding.origin === 'https://api.orulink.ai')) || !cp.result ||
        !/^[a-f0-9]{64}$/i.test(cp.binding.originalSha256) || await FS.hash(path, 'sha256') !== cp.binding.originalSha256) return invalid()
    try {
      initialMeetingJob(cp.job.id, cp.job.model, cp.job.owner)
      parseMeetingFileResult(cp.job, { ...cp.result, id: cp.job.id, model: cp.binding.providerModel }, cp.binding.duration, cp.binding.providerModel)
    } catch { return invalid() }
    duration = cp.binding.duration
    transcript = cp.result.text
    asrEvidence = cp
    if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请重新核对原录音')
    const evidenceKey = JSON.stringify([owner, recordId, record.uri, record.title, record.createdAt, model, cp])
    return { owner, epoch, recordId, evidenceKey, record, transcript, evidence: meetingFileEvidence(cp.result) }
  } else {
  if (!asr || ![2, 3, 4, 5].includes(asr.version) || asr.model !== model ||
      record.generation && record.generation.asrModel !== model || !matches(asr.source) ||
      !Number.isFinite(asr.duration) || asr.duration <= 0 ||
      asr.version === 4 && ![12, 60].includes(asr.chunkSeconds!)) return invalid()
  const intervals = migrateIntervals(asr, asr.duration)
  if (!intervals.length || intervals.length > 65536) return invalid()
  let cursor = 0
  for (const part of intervals) {
    if (part.start !== cursor || !Number.isFinite(part.end) || part.end <= cursor || part.end > asr.duration ||
        Math.abs(part.end * 16000 - Math.round(part.end * 16000)) > 1e-6 || typeof part.text !== 'string') return invalid()
    cursor = part.end
  }
  if (cursor !== asr.duration || !intervals.some(part => part.text.trim())) return invalid()
  duration = asr.duration
  transcript = intervals.map(part => `[录音区间 ${part.start.toFixed(3)}–${part.end.toFixed(3)} 秒]\n${part.text || '（本区间未识别到语音）'}`).join('\n\n')
  asrEvidence = asr
  }
  if (!speaker || speaker.version !== 1 || speaker.provider !== 'sherpa-onnx-1.12.35' || !matches(speaker.source) ||
      speaker.duration !== duration || speaker.clusteringVersion !== 2 || !speaker.turns?.length) return invalid()
  const analysis = speaker.analysis
  // A legacy whole-file result has no window cursor; completed clustering is still required.
  if (analysis && (analysis.version !== 2 || analysis.windowSeconds !== 120 ||
      analysis.totalWindows !== Math.ceil(speaker.duration / 120) ||
      analysis.completedWindows !== analysis.totalWindows)) return invalid()
  let lastEnd = 0
  for (const turn of speaker.turns) {
    if (!Number.isFinite(turn.start) || !Number.isFinite(turn.end) || turn.start < lastEnd ||
        turn.end <= turn.start || turn.end > speaker.duration || typeof turn.speakerId !== 'string' || !turn.speakerId) return invalid()
    lastEnd = turn.end
  }
  if (await readAccountId() !== owner || identityEpoch() !== epoch) throw new Error('账号已切换，请重新核对原录音')
  // Exact comparison, not a lossy hash. Raw transcript alone is never coverage evidence.
  const evidenceKey = JSON.stringify([owner, recordId, record.uri, record.title, record.createdAt,
    model, asrEvidence, speaker, record.speakerAliases || {}])
  return { owner, epoch, recordId, evidenceKey, record, transcript }
}
