export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export class TransportError extends Error {}
export async function decodeResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data: any
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!response.ok) {
    const message = data?.error?.message || data?.msg || data?.error_description || data?.message || data?.detail
    throw new ApiError(typeof message === 'string' ? message : `服务请求失败（HTTP ${response.status}）`, response.status)
  }
  return data as T
}
export async function timedFetch(url: string, init: RequestInit, timeout = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try { return await fetch(url, { ...init, signal: controller.signal, credentials: 'omit' }) }
  catch {
    throw new TransportError(url.includes('/auth/v1/')
      ? '账号服务连接失败，请确认当前 Wi-Fi 的账号网络通道可用后重试。'
      : '会议服务连接失败或请求超时，请稍后重试。原始录音仍保留在本机。')
  }
  finally { clearTimeout(timer) }
}
