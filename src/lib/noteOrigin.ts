export function noteOrigin(client?: string | null) {
  return client === 'mobile' ? 'App 生成' : client === 'desktop' ? '桌面端生成' : client === 'web' ? '网页端生成' : '来源未知'
}
