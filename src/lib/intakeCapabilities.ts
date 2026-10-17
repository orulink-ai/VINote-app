// UI guidance only. The content runtime must enforce its own download policy.
export type VideoUrlCapabilities = { video_url: boolean; video_url_platforms?: string[] }
export function validVideoUrlPlatforms(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 16 && new Set(value).size === value.length &&
    value.every(platform => typeof platform === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(platform))
}
export function allowsBilibili(capabilities: VideoUrlCapabilities) {
  if (capabilities.video_url !== true) return false
  return capabilities.video_url_platforms === undefined ? capabilities.video_url === true :
    validVideoUrlPlatforms(capabilities.video_url_platforms) && capabilities.video_url_platforms.includes('bilibili')
}
export function isVideoUrlAllowed(value: string, capabilities: VideoUrlCapabilities) {
  if (capabilities.video_url !== true) return false
  if (!isExplicitVideoUrl(value)) return true
  if (capabilities.video_url_platforms === undefined) return capabilities.video_url === true
  if (!validVideoUrlPlatforms(capabilities.video_url_platforms)) return false
  return isBilibiliUrl(value) && allowsBilibili(capabilities)
}
export function isBilibiliUrl(value: string) {
  try {
    const link = value.trim().match(/https?:\/\/[^\s<>"，。]+/i)?.[0]
    const host = new URL(link || '').hostname.toLowerCase().replace(/\.$/, '')
    return /(^|\.)(bilibili\.com|b23\.tv)$/.test(host)
  } catch { return false }
}
export function videoUrlUnavailableMessage(capabilities: VideoUrlCapabilities) {
  return allowsBilibili(capabilities) ? '目前仅支持 B 站视频链接，其他视频或音频请下载后导入文件。' :
    '暂不支持视频或音频链接，请下载后导入文件。普通网页、PDF 和 Word 链接仍可使用。'
}
export function isExplicitVideoUrl(value: string) {
  const link = value.trim().match(/https?:\/\/[^\s<>"，。]+/i)?.[0]
  if (!link) return false
  try {
    const url = new URL(link)
    return /(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be|douyin\.com|ixigua\.com|youku\.com|acfun\.cn|v\.qq\.com)$/i.test(url.hostname.replace(/\.$/, '')) ||
      /\.(mp4|mov|mkv|webm|avi|m4v|flv|m3u8|mp3|m4a|wav|aac|flac|ogg|opus)$/i.test(url.pathname)
  } catch { return false }
}
