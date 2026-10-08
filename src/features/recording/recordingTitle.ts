export function recordingTitle(createdAt: string, topic = '会议录音') {
  const parsed = new Date(createdAt)
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}｜${topic}`
}
// 从已经生成的纪要提取主题，不为仅录音模式发起模型请求。
export function summaryTopic(content: string): string | undefined {
  const heading = content.match(/^# (.+)$/m)?.[1]?.replace(/[*_`]/g, '').trim()
  if (!heading || /^(会议纪要|主题概览|会议总结|初稿|纪要初稿)([：: ].*)?$/.test(heading)) return undefined
  return heading.slice(0, 30)
}
