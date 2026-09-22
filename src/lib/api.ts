import { API_BASE_URL } from '../config/env'
import { readToken } from './storage'

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const token = await readToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}

export async function apiJson<T>(path: string, init: RequestInit = {}) {
  const response = await apiFetch(path, init)
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let payload: unknown = text
  try { payload = text ? JSON.parse(text) : null } catch { /* plain response */ }
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload && 'detail' in payload
      ? (payload as { detail?: unknown }).detail
      : payload
    throw new Error(typeof detail === 'string' ? detail : '请求失败，请稍后重试')
  }
  return payload as T
}
