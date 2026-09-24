import { Platform } from 'react-native'
import { SUPABASE_KEY, AUTH_BASE_URL } from '../config/env'
import { ApiError, decodeResponse, timedFetch } from './errors'
import { readSession, saveSession, Session, sessionRevision } from './storage'
export async function authRequest<T>(path: string, body?: unknown, token?: string, method?: string): Promise<T> {
  return decodeResponse<T>(await timedFetch(`${AUTH_BASE_URL}/auth/v1${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json',
      'X-VINote-Client': 'mobile', 'X-VINote-Platform': Platform.OS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 30000))
}
let refreshing: Promise<string> | null = null
export async function accessToken(refresh = false): Promise<string> {
  const session = await readSession()
  if (!session) throw new ApiError('请重新登录账号', 401)
  if (!refresh) return session.access_token
  if (!refreshing) {
    const revision = sessionRevision()
    refreshing = (async () => {
      let next: Session
      try { next = await authRequest<Session>('/token?grant_type=refresh_token', { refresh_token: session.refresh_token }) }
      catch (error) {
        if (error instanceof ApiError && [400, 401, 403].includes(error.status)) throw new ApiError('登录已过期，请重新登录', 401)
        throw error
      }
      if (sessionRevision() !== revision) throw new ApiError('账号已切换，请重新操作', 401)
      await saveSession(next)
      return next.access_token
    })().finally(() => { refreshing = null })
  }
  return refreshing
}
