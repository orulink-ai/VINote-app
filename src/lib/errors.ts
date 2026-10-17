export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: { code?: string; requestId?: string }) { super(message) }
}
export class TransportError extends Error {}
/** Issued by the model transport only when no HTTP send was attempted. */
export class ModelRequestNotSent extends Error {
  readonly dispatchCode = 'MODEL_REQUEST_NOT_SENT'
  get code() {
    const value = this.reason && typeof this.reason === 'object' && 'code' in this.reason ? this.reason.code : undefined
    return typeof value === 'string' ? value : this.dispatchCode
  }
  constructor(public readonly reason: unknown) { super(reason instanceof Error ? reason.message : '请求尚未发送，请核验账号后继续') }
}
export async function decodeResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data: any
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!response.ok) {
    const code = data?.error?.code || data?.error_code || data?.code
    const message = code === 'signup_disabled'
      ? '新账号注册尚未开放，请联系管理员。'
      : code === 'weak_password'
        ? '密码不符合账号安全要求，请使用至少 6 位且更复杂的密码。'
      : data?.error?.message || data?.msg || data?.error_description || data?.message || data?.detail
    const requestId = response.headers?.get('x-request-id') || undefined
    throw new ApiError(typeof message === 'string' ? message : `服务请求失败（HTTP ${response.status}）`, response.status,
      { ...(typeof code === 'string' ? { code: code.slice(0, 120) } : {}), ...(requestId ? { requestId: requestId.slice(0, 120) } : {}) })
  }
  return data as T
}
export async function timedFetch(url: string, init: RequestInit, timeout = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try { return await fetch(url, { ...init, signal: controller.signal, credentials: 'omit' }) }
  catch (error) {
    if (__DEV__) console.warn('[VINote] network request failed', new URL(url).host,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    throw new TransportError(url.includes('/auth/v1/')
      ? '账号服务暂时无法连接，请检查网络后重试。'
      : '连接失败或请求超时，请稍后重试。已保存内容仍保留。')
  }
  finally { clearTimeout(timer) }
}
