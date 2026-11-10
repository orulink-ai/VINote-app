import type { MeetingFileJob } from './meetingFileJobState'

export type MeetingFileSegment = { start: number; end: number; text: string; speakerId?: string; speakerLabel?: string }
export type MeetingFileResult = { text: string; segments: MeetingFileSegment[] }

/** Preserve provider evidence; do not invent sentence timestamps or speaker identity. */
export function parseMeetingFileResult(job: MeetingFileJob, value: unknown, duration: number, providerModel: string): MeetingFileResult {
  if (job.phase !== 'result' || !value || typeof value !== 'object' || !Number.isFinite(duration) || duration <= 0 || !providerModel.trim()) throw new Error('会议转写结果无效')
  const result = value as Record<string, unknown>
  if (result.id !== job.id || result.model !== providerModel || result.unrecognized === true || typeof result.text !== 'string' || !result.text.trim() || !Array.isArray(result.segments)) {
    throw new Error('会议转写结果与原任务不一致或没有有效文字')
  }
  const segments = result.segments.map((item: unknown): MeetingFileSegment => {
    if (!item || typeof item !== 'object') throw new Error('会议转写时间轴无效')
    const s = item as Record<string, unknown>
    if (typeof s.start !== 'number' || !Number.isFinite(s.start) || s.start < 0 || typeof s.end !== 'number' ||
        !Number.isFinite(s.end) || s.end < s.start || s.end > duration + 0.1 || typeof s.text !== 'string' ||
        (s.speakerId !== undefined && typeof s.speakerId !== 'string') ||
        (s.speakerLabel !== undefined && typeof s.speakerLabel !== 'string')) throw new Error('会议转写时间轴无效')
    return { start: s.start, end: s.end, text: s.text,
      ...(typeof s.speakerId === 'string' ? { speakerId: s.speakerId } : {}),
      ...(typeof s.speakerLabel === 'string' ? { speakerLabel: s.speakerLabel } : {}) }
  })
  return { text: result.text, segments }
}
