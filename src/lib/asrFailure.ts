// Allowlisted classifications only. Never retain service text, session IDs or credentials.
const categories = {
  unknown_error: 0, unknown_result: 1, empty_result_unverified: 2, asr_empty_result: 3,
  asr_incomplete_result: 4, asr_protocol_error: 5, asr_provider_error: 6,
  asr_auth_rejected: 7, asr_connect_failed: 8, asr_connect_timeout: 9,
  asr_stream_failed: 10, asr_audio_send_failed: 11, asr_config_invalid: 12,
  asr_failed: 13, asr_timeout: 14,
} as const
export type ASRDiagnostic = Readonly<{ category: number; stage: number; audioAttempted: 0 | 1; sentComplete: 0 | 1;
  origin?: 'server_error' | 'socket_close' | 'socket_error' | 'deadline' | 'send_error';
  closeCode?: number; readerMode?: 0 | 1;
  submittedBytes?: number; submittedFrames?: number; nativeReadBytes?: number; nativeReadCount?: number
  transportMode?: 1; transportFailure?: number; transportQueuePeakBytes?: number
}>
export class ASRServiceFailure extends Error {
  readonly code: keyof typeof categories
  readonly diagnostic: ASRDiagnostic
  constructor(code: unknown, stage: unknown, audioAttempted: boolean, sentComplete: boolean) {
    const safe = typeof code === 'string' && Object.prototype.hasOwnProperty.call(categories, code)
      ? code as keyof typeof categories : 'unknown_error'
    super(safe === 'unknown_result'
      ? '转写结果尚未确认，未自动重新发送音频；原录音与已保存转写保留'
      : safe === 'empty_result_unverified' || safe === 'asr_empty_result'
        ? '未得到已确认的转写文字，请检查录音；尚不能判断是否没有语音'
        : '识别服务未完成转写，请核对当前模型与已保存进度')
    this.code = safe
    this.diagnostic = Object.freeze({ category: categories[safe],
      stage: stage === 'session' ? 1 : stage === 'asr' ? 2 : stage === 'audio' ? 3 : 0,
      audioAttempted: audioAttempted ? 1 : 0, sentComplete: sentComplete ? 1 : 0 })
  }
}

// Diagnostics are separate from retry classification and never copy an event/error body.
const diagnostics = new WeakMap<Error, ASRDiagnostic>()
const origins = new Set(['server_error', 'socket_close', 'socket_error', 'deadline', 'send_error'])
export function withASRDiagnostic(error: Error, details: {
  origin: unknown; closeCode?: unknown; readerMode: 0 | 1;
  submittedBytes: number; submittedFrames: number; nativeReadBytes: number; nativeReadCount: number
  transportMode?: 1; transportFailure?: number; transportQueuePeakBytes?: number
}, audioAttempted: boolean, sentComplete: boolean) {
  if (diagnostics.has(error)) return error // First failure wins, including cleanup-induced close.
  const base = error instanceof ASRServiceFailure ? error.diagnostic : {
    category: 0, stage: 2, audioAttempted: audioAttempted ? 1 as const : 0 as const,
    sentComplete: sentComplete ? 1 as const : 0 as const,
  }
  const safeCount = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0
  const closeCode = typeof details.closeCode === 'number' && Number.isInteger(details.closeCode)
    && details.closeCode >= 1000 && details.closeCode <= 4999 ? details.closeCode : undefined
  diagnostics.set(error, Object.freeze({ ...base,
    ...(typeof details.origin === 'string' && origins.has(details.origin) ? { origin: details.origin as ASRDiagnostic['origin'] } : {}),
    ...(closeCode !== undefined ? { closeCode } : {}), readerMode: details.readerMode === 1 ? 1 : 0,
    submittedBytes: safeCount(details.submittedBytes), submittedFrames: safeCount(details.submittedFrames),
    nativeReadBytes: safeCount(details.nativeReadBytes), nativeReadCount: safeCount(details.nativeReadCount),
    ...(details.transportMode === 1 ? { transportMode: 1 as const, transportQueuePeakBytes: safeCount(details.transportQueuePeakBytes ?? 0) } : {}),
    ...(Number.isInteger(details.transportFailure) && details.transportFailure! >= 0 && details.transportFailure! <= 10
      ? { transportFailure: details.transportFailure } : {}),
  }))
  return error
}
export function readASRDiagnostic(error: unknown): ASRDiagnostic | undefined {
  return error instanceof Error ? diagnostics.get(error) ?? (error instanceof ASRServiceFailure ? error.diagnostic : undefined) : undefined
}
