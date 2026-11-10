import { modelEligible, type ModelEligibilityInput } from './modelEligibility'

export type MeetingFilePolicy = { maxAudioSeconds: number; maxAudioBytes: number; supportsM4a?: boolean }

/** Identify a catalog entry independently of its current health. */
export function isMeetingFileModel(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return !!meetingFilePolicy({ ...value, runtimeStatus: 'available', availability: undefined })
}

/** A meeting file is dispatched only when the service explicitly declares its complete contract. */
export function meetingFilePolicy(value: unknown): MeetingFilePolicy | undefined {
  if (!value || typeof value !== 'object') return undefined
  const model = value as ModelEligibilityInput & { capabilities?: Record<string, unknown> }
  if (!modelEligible(model)) return undefined
  const c = model.capabilities
  if (!c || typeof c !== 'object' || !c.recordedAudio || typeof c.recordedAudio !== 'object') return undefined
  const p = c.recordedAudio as Record<string, unknown>
  const includes = (item: unknown, expected: string) => Array.isArray(item) && item.every(v => typeof v === 'string') && item.includes(expected)
  if (p.protocol !== 1 || p.supported !== true || p.strategy !== 'single_request' || p.policySource !== 'provider_model' ||
      !includes(c.useCases, 'meeting') || !includes(c.protocols, 'asr-recording') || !includes(c.audioFormats, 'wav') ||
      c.audioDelivery !== 'public' || c.speakerDiarization !== true || c.utteranceTimestamps !== true ||
      typeof c.maxAudioSeconds !== 'number' || !Number.isSafeInteger(c.maxAudioSeconds) || c.maxAudioSeconds <= 0 ||
      typeof c.maxAudioBytes !== 'number' || !Number.isSafeInteger(c.maxAudioBytes) || c.maxAudioBytes <= 0) return undefined
  return { maxAudioSeconds: c.maxAudioSeconds, maxAudioBytes: c.maxAudioBytes, ...(includes(c.audioFormats, 'm4a') ? { supportsM4a: true } : {}) }
}
