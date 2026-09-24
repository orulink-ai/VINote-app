import { API_BASE_URL } from '../config/env'
import { Platform } from 'react-native'
import { accessToken } from './supabase'
import { decodeResponse, timedFetch } from './errors'
export { ApiError } from './errors'
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-VINote-Client', 'mobile')
  headers.set('X-VINote-Platform', Platform.OS)
  headers.set('X-VILab-Client-Id', `vinote-app-${Platform.OS}`)
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${await accessToken()}`)
  let response = await timedFetch(`${API_BASE_URL}${path}`, { ...init, headers }, 360000)
  if (response.status === 401) {
    headers.set('Authorization', `Bearer ${await accessToken(true)}`)
    response = await timedFetch(`${API_BASE_URL}${path}`, { ...init, headers }, 360000)
  }
  return response
}
export async function apiJson<T>(path: string, init: RequestInit = {}) {
  return decodeResponse<T>(await apiFetch(path, init))
}
