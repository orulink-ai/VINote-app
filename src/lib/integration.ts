import deployment from '../../config/deployment.json'
import { Platform } from 'react-native'
import { readAccountId } from './storage'
import { accessToken } from './supabase'
import { ApiError } from './errors'
import { remoteRequest } from './remoteRequest'

export const integrationBaseUrl = (deployment.integrationBaseUrl || '').replace(/\/+$/, '')
export const generationBaseUrl = (__DEV__ ? 'http://127.0.0.1:8900' : '').replace(/\/+$/, '')
export function integrationOrigin(path: string) {
  return /^\/api\/(workspace(?:\/|$)|feishu(?:\/|$)|mcp-connections(?:\/|$)|plugins(?:\/|$))/.test(path) ? integrationBaseUrl : generationBaseUrl
}
export class IntegrationError extends ApiError {
  constructor(message: string, status: number, public code: string, public current?: unknown, public generatedContent?: string) {
    super(message, status, { code })
  }
}
export async function integrationJson<T>(path: string, init: RequestInit = {}, expectedOwner?: string, timeout = 45000, extraGuard?: () => void): Promise<T> {
  if (/^\/api\/workspace(?:\/|$)/.test(path)) throw new IntegrationError('跨设备同步已取消，资料由此设备管理', 410, 'WORKSPACE_REMOVED')
  extraGuard?.()
  const lifetime = remoteRequest(expectedOwner, timeout)
  try {
  const origin = integrationOrigin(path)
  if (!origin) throw new IntegrationError('当前内容处理服务尚未配置；已保存内容与原文件继续保留。', 503, 'INTEGRATION_NOT_CONFIGURED')
  if (!path.startsWith('/api/')) throw new Error('集成服务路径无效')
  const owner = await readAccountId()
  lifetime.guard()
  if (!owner || owner !== lifetime.scope.owner || (expectedOwner && owner !== expectedOwner)) throw new IntegrationError('账号已切换，请重新登录或加载', 401, 'ACCOUNT_CHANGED')
  const request = async (refresh = false) => {
    lifetime.guard(); extraGuard?.()
    const token = await accessToken(refresh, owner, lifetime.context)
    lifetime.guard(); extraGuard?.()
    if (await readAccountId() !== owner) throw new Error('账号已切换')
    const headers = new Headers(init.headers)
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('X-VINote-Client', 'mobile')
    headers.set('X-VINote-Platform', Platform.OS)
    lifetime.guard(); extraGuard?.()
    const response = await fetch(`${origin}${path}`, { ...init, headers, signal: lifetime.signal, credentials: 'omit' })
    lifetime.guard(); extraGuard?.(); return response
  }
  let response = await request()
  // Authentication rejection happens before dispatch. No retries on transport errors.
  if (response.status === 401) response = await request(true)
  const raw = await response.text()
  lifetime.guard(); extraGuard?.()
  let value: any
  try { value = raw ? JSON.parse(raw) : null } catch { throw new IntegrationError('集成服务返回格式异常，请重试读取状态', response.status, 'INVALID_RESPONSE') }
  if (await readAccountId() !== owner) throw new Error('账号已切换，请重新加载')
  if (!response.ok) {
    const detail = value?.detail ?? value
    throw new IntegrationError(typeof detail === 'string' ? detail : detail?.message || `服务暂不可用（HTTP ${response.status}）`, response.status, detail?.code || 'INTEGRATION_ERROR', detail?.current, typeof detail?.generated_content === 'string' ? detail.generated_content : undefined)
  }
  lifetime.guard(); extraGuard?.(); return value as T
  } finally { lifetime.close() }
}

// Identifiers only, never credentials. Persist before any side effect and reuse on retry.
export function operationId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 3) | 8).toString(16)
  })
}
