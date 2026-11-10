export function recordingTitle(createdAt: string, topic = '会议录音') {
  const parsed = new Date(createdAt)
  if (!createdAt.trim() || Number.isNaN(parsed.getTime())) return `时间未知｜${topic}`
  const date = parsed
  const pad = (value: number) => String(value).padStart(2, '0')
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  const suffix = topic.startsWith(timestamp) && /^[\s｜|]/.test(topic.slice(timestamp.length))
    ? topic.slice(timestamp.length).replace(/^[\s｜|]+/, '') || '会议录音'
    : topic
  return `${timestamp}｜${suffix}`
}
/** Older versions replaced default recording titles with the generated minutes title. */
type RecordingName = { title: string; createdAt: string; titleSource?: 'default' | 'manual' | 'ai'; source?: 'recording' | 'import' }

export function recordingDisplayName(record: RecordingName) {
  if (record.titleSource !== 'default' && record.titleSource !== 'ai') return record.title
  const unknown = record.source === 'import' ? '导入时间未记录' : '录制时间未记录'
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(record.createdAt)) return unknown
  const date = new Date(record.createdAt)
  if (Number.isNaN(date.getTime())) return unknown
  const pad = (part: number) => String(part).padStart(2, '0')
  const time = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return record.source === 'import' ? `${time}｜导入音频` : time
}

/** Match the desktop meeting row without using its title to rename the recording. */
export function meetingDisplayName(record: RecordingName, noteTitle?: string) {
  if (record.titleSource === 'manual' && record.title.trim()) return record.title
  const topic = (noteTitle || '').replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s*[|｜]\s*/, '').trim()
  if (topic && !/^(待生成纪要|录制时间未记录|未命名会议|未命名录制)$/.test(topic) && !/\.(?:wav|mp3|m4a|webm|mp4|ogg|flac)$/i.test(topic)) return topic
  return recordingDisplayName(record)
}
/** Hide the display prefix and its accidental exact duplicate without changing stored titles. */
export function displayRecordingTitle(title: string = '') {
  const match = title.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*[｜|]\s*(.*)$/)
  if (!match) return title
  let topic = match[2]
  if (topic.startsWith(match[1]) && /^[\s｜|]/.test(topic.slice(match[1].length))) {
    topic = topic.slice(match[1].length).replace(/^[\s｜|]+/, '')
  }
  return topic || title
}
// 从已经生成的纪要提取主题，不为仅录音模式发起模型请求。
export function summaryTopic(content: string): string | undefined {
  const heading = content.match(/^# (.+)$/m)?.[1]?.replace(/[*_`]/g, '').trim()
    .replace(/^(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}[|｜]\s*)+/, '').trim()
  if (!heading || /^(会议纪要|主题概览|会议总结|初稿|纪要初稿)([：: ].*)?$/.test(heading)) return undefined
  return heading.slice(0, 30)
}
