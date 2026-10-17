// UI guidance only. The content runtime must enforce its own download policy.
export function isExplicitVideoUrl(value: string) {
  const link = value.trim().match(/https?:\/\/[^\s<>"，。]+/i)?.[0]
  if (!link) return false
  try {
    const url = new URL(link)
    return /(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be|douyin\.com|ixigua\.com|youku\.com|acfun\.cn|v\.qq\.com)$/i.test(url.hostname) ||
      /\.(mp4|mov|mkv|webm|avi|m4v|flv|m3u8|mp3|m4a|wav|aac|flac|ogg|opus)$/i.test(url.pathname)
  } catch { return false }
}
