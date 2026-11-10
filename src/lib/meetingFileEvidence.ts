import type { MeetingFileResult } from './meetingFileResult'

/** Speaker numbers identify acoustic groups, never verified people. */
export function meetingFileEvidence(result: MeetingFileResult): string {
  const speakers = new Map<string, number>()
  const lines = result.segments.filter(segment => segment.text.trim()).map(segment => {
    let speaker = '说话人待确认'
    const id = segment.speakerId?.trim()
    if (id === 'speaker_overlap') speaker = '重叠发言 · 归属待确认'
    else if (id && id !== 'speaker_unknown' && !id.startsWith('speaker_window_')) {
      if (!speakers.has(id)) speakers.set(id, speakers.size + 1)
      speaker = `说话人 ${speakers.get(id)}`
    }
    return `${segment.start.toFixed(2)}–${segment.end.toFixed(2)} 秒 · ${speaker}：${segment.text.trim()}`
  })
  return `【完整转写】\n${result.text.trim()}\n\n【带时间的识别片段】\n${lines.join('\n') || '说话人待确认'}\n\n片段是对完整转写的补充，不是另一场发言；说话人编号仅代表语音分组，不代表真实身份。`
}
