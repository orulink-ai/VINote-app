import { API_BASE_URL } from '../config/env'
import { Platform } from 'react-native'
import { accessToken } from './supabase'
import { ApiError, ModelRequestNotSent, decodeResponse } from './errors'
import { readSession } from './storage'
import { requestTextStream } from './textStream'
import { remoteRequest } from './remoteRequest'
import { assertRemoteScope, captureRemoteScope } from './sessionGate'
export { ApiError } from './errors'
async function authorize(init: RequestInit, expectedAccountId?: string) {
  const session = await readSession()
  if (!session) throw new ApiError('请重新登录账号', 401)
  const account = session.user.id
  if (expectedAccountId && account !== expectedAccountId) throw new ApiError('账号已切换，请重新操作', 401)
  const headers = new Headers(init.headers)
  headers.set('X-VINote-Client', 'mobile')
  headers.set('X-VINote-Platform', Platform.OS)
  headers.set('X-VILab-Client-Id', `vinote-app-${Platform.OS}`)
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${session.access_token}`)
  return { account, headers }
}
export async function apiFetch(path: string, init: RequestInit = {}, expectedAccountId?: string) {
  const lifetime = remoteRequest(expectedAccountId, 360000)
  try {
  const { account, headers } = await authorize(init, expectedAccountId || lifetime.scope.owner)
  lifetime.guard()
  let response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: lifetime.signal, credentials: 'omit' })
  lifetime.guard()
  if (response.status === 401) {
    headers.set('Authorization', `Bearer ${await accessToken(true, account, lifetime.context)}`)
    lifetime.guard()
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: lifetime.signal, credentials: 'omit' })
    lifetime.guard()
  }
  return response
  } finally { lifetime.close() }
}
export async function apiJson<T>(path: string, init: RequestInit = {}, expectedAccountId?: string) {
  const scope = captureRemoteScope(expectedAccountId)
  const value = await decodeResponse<T>(await apiFetch(path, init, expectedAccountId))
  assertRemoteScope(scope); return value
}
export async function apiTextStream(path: string, init: RequestInit, receive: (text: string) => void, expectedAccountId?: string) {
  let lifetime: ReturnType<typeof remoteRequest> | undefined
  let attempted = false
  const sent = () => { attempted = true }
  try {
    // Keep gate creation inside this boundary: checking may reject before HTTP.
    lifetime = remoteRequest(expectedAccountId, 900000)
    const lease = lifetime
    const { account, headers } = await authorize(init, expectedAccountId || lease.scope.owner)
    lease.guard()
    const guardedReceive = (text: string) => { lease.guard(); receive(text) }
    headers.set('Accept', 'text/event-stream')
    let response = await requestTextStream(`${API_BASE_URL}${path}`, { ...init, headers, signal: lease.signal }, guardedReceive, sent)
    attempted = true // A returned HTTP response is also definitive send evidence.
    lease.guard()
    if (response.status === 401) {
      headers.set('Authorization', `Bearer ${await accessToken(true, account, lease.context)}`)
      lease.guard()
      response = await requestTextStream(`${API_BASE_URL}${path}`, { ...init, headers, signal: lease.signal }, guardedReceive, sent)
      lease.guard()
    }
    if (response.status < 200 || response.status >= 300) {
      await decodeResponse({ status: response.status, ok: false, headers: new Headers(response.requestId ? { 'x-request-id': response.requestId } : {}),
        text: async () => response.text } as Response)
    }
    if (!response.contentType.toLowerCase().startsWith('text/event-stream')) throw new Error('总结服务未返回流式响应，请检查服务配置；转写已保存')
  } catch (error) {
    if (!attempted) throw new ModelRequestNotSent(error)
    throw error
  } finally { lifetime?.close() }
}
