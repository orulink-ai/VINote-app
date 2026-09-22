import { apiJson } from './api'
import { clearToken, saveToken } from './storage'
import type { AuthResponse, User } from '../types/api'

export async function signIn(email: string, password: string) {
  const result = await apiJson<AuthResponse>('/api/auth/sign-in', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
  await saveToken(result.access_token)
  return result
}

export async function signUp(email: string, password: string) {
  const result = await apiJson<AuthResponse>('/api/auth/sign-up', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
  await saveToken(result.access_token)
  return result
}

export async function fetchMe() { return apiJson<User>('/api/auth/me') }
export async function signOut() {
  try { await apiJson<void>('/api/auth/sign-out', { method: 'POST' }) } finally { await clearToken() }
}
