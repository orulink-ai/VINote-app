import { ApiError } from './errors'
import { authRequest, accessToken } from './supabase'
import { clearToken, saveSession, Session } from './storage'
import type { User } from '../types/api'
async function acceptSession(result: Session) {
  if (!result.access_token || !result.refresh_token || !result.user?.id) throw new Error('请先完成邮箱验证')
  await saveSession(result)
  return { ...result.user, access_token: result.access_token, token_type: 'bearer' }
}
export async function signIn(email: string, password: string) {
  return acceptSession(await authRequest<Session>('/token?grant_type=password', { email: email.trim(), password }))
}
export async function signUp(email: string, password: string) {
  return acceptSession(await authRequest<Session>('/signup', { email: email.trim(), password }))
}
export async function fetchMe() {
  try { return await authRequest<User>('/user', undefined, await accessToken()) }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    return authRequest<User>('/user', undefined, await accessToken(true))
  }
}
export async function requestRegistration(email: string, password: string) {
  await authRequest('/signup', { email: email.trim(), password })
  return { message: '验证码已发送，请查看邮箱' }
}
export async function verifyRegistration(email: string, code: string) {
  return acceptSession(await authRequest<Session>('/verify', { email: email.trim(), token: code.trim(), type: 'signup' }))
}
export async function getAuthConfig() { return { email_code: true } }
export async function requestPasswordReset(email: string) {
  await authRequest('/recover', { email: email.trim() })
  return { message: '重置验证码已发送，请查看邮箱' }
}
export async function resetPassword(email: string, code: string, password: string) {
  const session = await authRequest<Session>('/verify', { email: email.trim(), token: code.trim(), type: 'recovery' })
  await authRequest('/user', { password }, session.access_token, 'PUT')
  return { message: '密码已更新，请使用新密码登录' }
}
// 只移除当前手机凭证，不撤销桌面端的登录会话。
export async function signOut() { await clearToken() }
