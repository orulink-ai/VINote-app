import { assertRemoteScope, captureRemoteScope, assertUploadScope, captureUploadScope, subscribeGate, type RemoteScope } from './sessionGate'
import type { AuthContext } from './supabase'
import { TransportError } from './errors'

// One lifetime covers credential refresh, request and decoding. No orphaned race.
export function remoteRequest(owner?: string, timeout = 45000, expected?: RemoteScope, allowBackgroundChecking = false) {
  const scope = allowBackgroundChecking ? captureUploadScope(owner) : expected || captureRemoteScope(owner)
  const assertScope = () => allowBackgroundChecking ? assertUploadScope(scope as ReturnType<typeof captureUploadScope>) : assertRemoteScope(scope as RemoteScope)
  assertScope()
  if (owner && scope.owner !== owner) throw new Error('账号已切换，原操作已停止')
  const controller = new AbortController()
  const guard = () => {
    assertScope()
    if (controller.signal.aborted) throw new TransportError('连接已停止或超时；本机内容与原请求记录仍保留')
  }
  const unsubscribe = subscribeGate(() => { try { assertScope() } catch { controller.abort() } })
  const timer = setTimeout(() => controller.abort(), timeout)
  const context: AuthContext = { signal: controller.signal, origin: scope.authOrigin, expectedOwner: scope.owner, guard }
  return { scope, context, guard, signal: controller.signal,
    close: () => { clearTimeout(timer); unsubscribe() } }
}
