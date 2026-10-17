import deployment from '../../config/deployment.json'
import { Platform } from 'react-native'
import { readAccountId } from './storage'
import { accessToken } from './supabase'
import { ApiError } from './errors'
import { remoteRequest } from './remoteRequest'
import { resolveGenerationBaseUrl } from '../config/generationService'
import { isExplicitVideoUrl, isVideoUrlAllowed, validVideoUrlPlatforms, videoUrlUnavailableMessage } from './intakeCapabilities'

export const integrationBaseUrl = (deployment.integrationBaseUrl || '').replace(/\/+$/, '')
export const generationBaseUrl = resolveGenerationBaseUrl(deployment, __DEV__)
const capabilitiesPath = '/api/content-service/capabilities'
export type ContentServiceCapabilities = { content_service_protocol: 1; generation: true; sync: false; max_upload_bytes: number; video_url: boolean; video_url_reason?: string; video_url_platforms?: string[]; video_source_preflight?: 1; text_extraction_protocol?: 1 }
const integrationPath = (path: string) => /^\/api\/(workspace(?:\/|$)|feishu(?:\/|$)|mcp-connections(?:\/|$)|plugins(?:\/|$))/.test(path)
export function integrationOrigin(path: string) {
  return integrationPath(path) ? integrationBaseUrl : generationBaseUrl
}
function assertContentCapabilities(value: unknown) {
  const data = value as Partial<ContentServiceCapabilities> | null
  if (data?.content_service_protocol !== 1 || data.sync !== false) throw new IntegrationError('当前内容处理服务版本尚不兼容，请联系管理员更新；原资料与任务记录保留。', 503, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED')
  if (data.generation !== true) throw new IntegrationError('内容处理服务尚未启用生成，请联系管理员；原资料与任务记录保留。', 503, 'CONTENT_SERVICE_DISABLED')
  if (!Number.isSafeInteger(data.max_upload_bytes) || Number(data.max_upload_bytes) <= 0) throw new IntegrationError('内容处理服务缺少有效文件上限，请联系管理员更新。', 503, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED')
  if (typeof data.video_url !== 'boolean') throw new IntegrationError('内容处理服务缺少有效链接处理规则，请联系管理员更新。', 503, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED')
  if ('video_url_platforms' in data && !validVideoUrlPlatforms(data.video_url_platforms)) throw new IntegrationError('内容处理服务的视频平台规则无效，请联系管理员更新。', 503, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED')
  if ('video_source_preflight' in data && data.video_source_preflight !== 1) throw new IntegrationError('内容处理服务的来源预检协议不兼容，请联系管理员更新。', 503, 'CONTENT_SERVICE_PROTOCOL_UNSUPPORTED')
}
function contentUnavailable(status: number) {
  return new IntegrationError(
    status === 401 ? '登录已失效，请重新登录后核验内容服务。' : status === 403 ? '当前账号无权使用内容处理服务，请联系管理员。' : '内容处理服务尚未就绪，请联系管理员检查部署；原资料与任务记录保留。',
    status, 'CONTENT_SERVICE_UNAVAILABLE')
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
  const request = async (refresh = false, requestPath = path, preflight = false) => {
    lifetime.guard(); extraGuard?.()
    const token = await accessToken(refresh, owner, lifetime.context)
    lifetime.guard(); extraGuard?.()
    if (await readAccountId() !== owner) throw new Error('账号已切换')
    const requestInit: RequestInit = preflight ? { method: 'GET' } : init
    const headers = new Headers(requestInit.headers)
    if (!(requestInit.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('X-VINote-Client', 'mobile')
    headers.set('X-VINote-Platform', Platform.OS)
    lifetime.guard(); extraGuard?.()
    const response = await fetch(`${origin}${requestPath}`, { ...requestInit, headers, signal: lifetime.signal, credentials: 'omit' })
    lifetime.guard(); extraGuard?.(); return response
  }
  // This GET never submits source/model work. A shared Feishu URL alone is not
  // evidence of a content runtime. Metro retains its existing local API contract.
  if (!__DEV__ && !integrationPath(path) && path !== capabilitiesPath) {
    let probe: Response
    try {
      probe = await request(false, capabilitiesPath, true)
      if (probe.status === 401) probe = await request(true, capabilitiesPath, true)
    } catch {
      lifetime.guard(); extraGuard?.()
      throw new IntegrationError('暂时无法核验内容处理服务，请检查网络后重新读取；原资料与任务记录保留。', 503, 'CONTENT_SERVICE_UNVERIFIED')
    }
    if (!probe.ok) throw contentUnavailable(probe.status)
    let capabilities: unknown
    try { capabilities = await probe.json() } catch { capabilities = null }
    lifetime.guard(); extraGuard?.()
    assertContentCapabilities(capabilities)
    if (path === '/api/generate' && (init.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string') {
      let source: unknown
      try { source = JSON.parse(init.body)?.video_url } catch { /* Backend validates malformed source bodies. */ }
      if (typeof source === 'string' && isExplicitVideoUrl(source) && !isVideoUrlAllowed(source, capabilities as ContentServiceCapabilities)) {
        throw new IntegrationError(videoUrlUnavailableMessage(capabilities as ContentServiceCapabilities), 400, 'VIDEO_URL_PLATFORM_UNAVAILABLE')
      }
    }
  }
  let response = await request()
  // Authentication rejection happens before dispatch. No retries on transport errors.
  if (response.status === 401) response = await request(true)
  if (path === capabilitiesPath && !response.ok) throw contentUnavailable(response.status)
  const raw = await response.text()
  lifetime.guard(); extraGuard?.()
  let value: any
  try { value = raw ? JSON.parse(raw) : null } catch { throw new IntegrationError('集成服务返回格式异常，请重试读取状态', response.status, 'INVALID_RESPONSE') }
  if (await readAccountId() !== owner) throw new Error('账号已切换，请重新加载')
  if (!response.ok) {
    const detail = value?.detail ?? value
    throw new IntegrationError(typeof detail === 'string' ? detail : detail?.message || `服务暂不可用（HTTP ${response.status}）`, response.status, detail?.code || 'INTEGRATION_ERROR', detail?.current, typeof detail?.generated_content === 'string' ? detail.generated_content : undefined)
  }
  lifetime.guard(); extraGuard?.()
  if (path === capabilitiesPath) assertContentCapabilities(value)
  return value as T
  } finally { lifetime.close() }
}

export async function verifyContentService(owner: string, guard?: () => void) {
  try { return await integrationJson<ContentServiceCapabilities>(capabilitiesPath, { method: 'GET' }, owner, 15000, guard) }
  catch (cause) {
    if (cause instanceof IntegrationError) throw cause
    throw new IntegrationError('暂时无法核验内容处理服务，请检查网络后重新读取；原资料与任务记录保留。', 503, 'CONTENT_SERVICE_UNVERIFIED')
  }
}

// Identifiers only, never credentials. Persist before any side effect and reuse on retry.
export function operationId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 3) | 8).toString(16)
  })
}
