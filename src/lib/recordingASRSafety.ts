import type { LocalRecording } from '../features/recording/recordingLibrary'
/** Unknown historical executions remain immutable even after the catalog gains a policy. */
export function recordingASRBlocked(record: Pick<LocalRecording, 'error' | 'errorDetails' | 'transcriptionCheckpoint'>) {
  return !!(record.transcriptionCheckpoint?.version === 5 && record.transcriptionCheckpoint.inFlight) ||
    ['unknown_result', 'unknown_error', 'empty_result_unverified', 'asr_empty_result', 'asr_incomplete_result'].includes(record.errorDetails?.code || '') ||
    record.errorDetails?.asrDiagnostic?.category === 1 ||
    /unknown_result|结果尚未确认|结果未确认/.test(record.error || '')
}
export const RECORDING_ASR_BLOCKED = '上次转写结果尚未确认，不能重新发送音频；原录音和历史进度保留'
