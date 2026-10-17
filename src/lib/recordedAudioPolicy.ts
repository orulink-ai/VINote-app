/** Service invocation policy, never a model duration/capability inference. */
export type RecordedAudioPolicy = {
  protocol: 1; supported: true; strategy: 'adaptive_pause'; maxSessionAudioBytes: number; policySource: 'service_budget'
}
export type RecordedAudioCapabilities = { capabilities?: { recordedAudio?: unknown } }
export function validAudioBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 640 && value <= 64 * 1024 * 1024 && value % 2 === 0
}
export function recordedAudioPolicy(model: RecordedAudioCapabilities | undefined): RecordedAudioPolicy | undefined {
  const raw = model?.capabilities?.recordedAudio
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Partial<RecordedAudioPolicy>
  return p.protocol === 1 && p.supported === true && p.strategy === 'adaptive_pause' && p.policySource === 'service_budget' && validAudioBudget(p.maxSessionAudioBytes)
    ? { protocol: 1, supported: true, strategy: 'adaptive_pause', maxSessionAudioBytes: p.maxSessionAudioBytes, policySource: 'service_budget' } : undefined
}
export function recordedAudioUsage(model: RecordedAudioCapabilities | undefined) {
  return recordedAudioPolicy(model)
    ? '适用于录音与会议纪要；长录音优先按停顿分段，始终使用所选模型。'
    : '当前服务的录音转写尚未就绪，请更新服务后重试。'
}
