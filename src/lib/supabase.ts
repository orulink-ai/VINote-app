import { Platform } from 'react-native'
import { SUPABASE_KEY, AUTH_BASE_URL } from '../config/env'
import { ApiError, decodeResponse, timedFetch } from './errors'
import { readSession, saveSession, Session, sessionRevision } from './storage'
import { assertIdentity, identityScope } from './sessionGate'
import { SessionScopeChangedError } from './sessionIdentity'
import type { VerificationTrace } from './verificationDiagnostics'
import { isInvalidRefreshSessionCode, markUnclassifiedRefreshError } from './supabaseAuthCode'
export type AuthContext = { signal: AbortSignal; origin: string; guard: () => void; expectedOwner: string; trace?: VerificationTrace }
export async function authRequest<T>(path: string, body?: unknown, token?: string, method?: string, context?: AuthContext): Promise<T> {
  context?.guard()
  if (context && context.origin !== AUTH_BASE_URL.replace(/\/+$/, '')) throw new SessionScopeChangedError()
  const init: RequestInit = {
    method: method || (body ? 'POST' : 'GET'),
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json',
      'X-VINote-Client': 'mobile', 'X-VINote-Platform': Platform.OS,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  const url = `${context?.origin || AUTH_BASE_URL}/auth/v1${path}`
  const stage = path === '/user' ? 'user_http' : 'refresh_http'
  context?.trace?.(stage, 'start')
  let response: Response
  try { response = context ? await fetch(url, { ...init, signal: context.signal, credentials: 'omit' }) : await timedFetch(url, init, 30000) }
  catch (cause) { context?.trace?.(stage, context.signal.aborted ? 'deadline' : 'transport'); throw cause }
  context?.trace?.(stage, 'http', response.status)
  context?.guard()
  context?.trace?.('decode', 'start')
  let value: T
  try { value = await decodeResponse<T>(response) }
  catch (cause) {
    if (cause instanceof ApiError) context?.trace?.(stage, 'http', cause.status, cause.details?.code)
    throw cause
  }
  context?.trace?.('decode', 'ok'); context?.guard(); return value
}
let refreshing: { account: string; origin: string; epoch: number; context?: AuthContext; promise: Promise<string> } | null = null
// Different request lifetimes must retain their own cancellation/lease guards,
// but may not rotate the same stored refresh token concurrently.
let refreshMutations: Promise<unknown> = Promise.resolve()
export async function accessToken(refresh = false, expectedAccountId?: string, context?: AuthContext): Promise<string> {
  context?.guard()
  context?.trace?.('session_read', 'start')
  let session: Session | null
  try { session = await readSession() }
  catch (cause) { context?.trace?.('session_read', 'storage'); throw cause }
  context?.trace?.('session_read', 'ok')
  context?.guard()
  if (!session) throw new ApiError('请重新登录账号', 401)
  const account = session.user.id
  if (expectedAccountId && account !== expectedAccountId) throw new ApiError('账号已切换，请重新操作', 401)
  if (!refresh) return session.access_token
  const scope = identityScope(account)
  const guard = () => { assertIdentity(scope); context?.guard() }
  guard()
  if (!refreshing || refreshing.account !== account || refreshing.origin !== scope.authOrigin || refreshing.epoch !== scope.epoch || refreshing.context !== context) {
    const revision = sessionRevision()
    const request = refreshMutations.then(async () => {
      guard()
      const current = await readSession()
      guard()
      if (!current || current.user.id !== account) throw new SessionScopeChangedError()
      // A preceding same-identity refresh already supplied this caller's token.
      // A real sign-in/out or A→B→A transition still fails the epoch guard above.
      if (sessionRevision() !== revision) return current.access_token
      let next: Session
      try { next = await authRequest<Session>('/token?grant_type=refresh_token', { refresh_token: current.refresh_token }, undefined, undefined, context) }
      catch (error) {
        guard()
        if (error instanceof ApiError) {
          if ([400, 401, 403].includes(error.status) && isInvalidRefreshSessionCode(error.details?.code))
            throw new ApiError('登录会话已失效，请重新登录；本机内容与草稿仍保留', 401, error.details)
          markUnclassifiedRefreshError(error)
        }
        throw error
      }
      guard()
      if (sessionRevision() !== revision || next.user?.id !== account) throw new SessionScopeChangedError()
      context?.trace?.('credential_save', 'start')
      try { await saveSession(next, { refresh: true, guard }) }
      catch (cause) { context?.trace?.('credential_save', 'storage'); throw cause }
      context?.trace?.('credential_save', 'ok'); guard()
      return next.access_token
    })
    refreshMutations = request.then(() => undefined, () => undefined)
    const entry = { account, origin: scope.authOrigin, epoch: scope.epoch, context, promise: request }
    refreshing = entry
    void request.finally(() => { if (refreshing === entry) refreshing = null }).catch(() => {})
  }
  const token = await refreshing.promise; guard(); return token
}
