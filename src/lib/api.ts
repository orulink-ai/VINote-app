import { API_BASE_URL } from '../config/env'
import { Platform } from 'react-native'
import { accessToken } from './supabase'
import { ApiError, decodeResponse, timedFetch } from './errors'
import { readSession } from './storage'
export { ApiError } from './errors'
export async function apiFetch(path: string, init: RequestInit = {}, expectedAccountId?: string) {
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
  let response = await timedFetch(`${API_BASE_URL}${path}`, { ...init, headers }, 360000)
  if (response.status === 401) {
    headers.set('Authorization', `Bearer ${await accessToken(true, account)}`)
    response = await timedFetch(`${API_BASE_URL}${path}`, { ...init, headers }, 360000)
  }
  return response
}
export async function apiJson<T>(path: string, init: RequestInit = {}, expectedAccountId?: string) {
  return decodeResponse<T>(await apiFetch(path, init, expectedAccountId))
}
