import { fetchMe } from './auth'
import { readAccountId } from './storage'
import { rememberVerifiedCache, trustedLocalCache } from './ownerCacheScope'
import { assertVerification, finishVerification, type Verification } from './sessionGate'
import { ApiError } from './errors'
import { SessionScopeChangedError } from './sessionIdentity'
import { verificationTrace, verificationFailure } from './verificationDiagnostics'
import { isRejectedUserAccessCode, isUnclassifiedRefreshError } from './supabaseAuthCode'

export async function verifySession(value: Verification, signal: AbortSignal) {
  const trace = verificationTrace()
  trace?.('verify', 'start')
  const guard = () => {
    assertVerification(value)
    if (signal.aborted) throw new Error('账号核验已取消或超时；本机内容保留')
  }
  try {
    guard()
    const user = await fetchMe({ expectedOwner: value.owner, origin: value.authOrigin, signal, guard, trace })
    guard()
    if (user.id !== value.owner) { finishVerification(value, 'expired'); return 'expired' as const }
    trace?.('owner_read', 'start')
    let currentOwner: string | null
    try { currentOwner = await readAccountId() }
    catch (cause) { trace?.('owner_read', 'storage'); throw cause }
    trace?.('owner_read', 'ok')
    if (currentOwner !== value.owner) throw new SessionScopeChangedError()
    guard()
    trace?.('proof_save', 'start')
    try { await rememberVerifiedCache(value) }
    catch (cause) { trace?.('proof_save', 'storage'); throw cause }
    trace?.('proof_save', 'ok'); guard()
    finishVerification(value, 'verified')
    trace?.('verify', 'ok')
    return 'verified' as const
  } catch (cause) {
    trace?.('verify', verificationFailure(cause, signal.aborted), cause instanceof ApiError ? cause.status : undefined,
      cause instanceof ApiError ? cause.details?.code : undefined)
    // A cancelled/stale attempt must never expire or acknowledge a new session.
    assertVerification(value)
    if (cause instanceof SessionScopeChangedError) throw cause
    if (cause instanceof ApiError && !isUnclassifiedRefreshError(cause) && !signal.aborted &&
      (cause.status === 401 || cause.status === 403 && isRejectedUserAccessCode(cause.details?.code))) {
      finishVerification(value, 'expired'); return 'expired' as const
    }
    const trusted = await trustedLocalCache(value)
    assertVerification(value)
    finishVerification(value, trusted ? 'offline-known' : 'checking')
    return trusted ? 'offline-known' as const : 'checking' as const
  }
}
