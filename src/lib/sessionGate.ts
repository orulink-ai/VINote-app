import deployment from '../../config/deployment.json'
import { AUTH_BASE_URL, API_BASE_URL } from '../config/env'
import { identityEpoch, identityOwner, subscribeIdentity, SessionScopeChangedError } from './sessionIdentity'

export type IdentityScope = { owner: string; epoch: number; authOrigin: string; integrationOrigin: string }
export type GateMode = 'checking' | 'verified' | 'offline-known' | 'expired' | 'signed-out'
export type Verification = IdentityScope & { attempt: number }
export type RemoteScope = IdentityScope & { lease: number }
let attempt = 0
let streamRevocation = 0
export type StreamScope = IdentityScope & { asrOrigin: string; revocation: number }
const issuedStreamScopes = new WeakSet<StreamScope>()
let state: { mode: GateMode; scope: IdentityScope | null } = { mode: 'checking', scope: null }
const listeners = new Set<() => void>()
const normalize = (value: string) => value.replace(/\/+$/, '')
const notify = () => listeners.forEach(listener => listener())
export function identityScope(owner: string): IdentityScope {
  return { owner, epoch: identityEpoch(), authOrigin: normalize(AUTH_BASE_URL), integrationOrigin: normalize(deployment.integrationBaseUrl || '') }
}
export function assertIdentity(scope: IdentityScope) {
  const current = identityScope(scope.owner), owner = identityOwner()
  if (current.epoch !== scope.epoch || current.authOrigin !== scope.authOrigin || current.integrationOrigin !== scope.integrationOrigin
    || (owner !== undefined && owner !== scope.owner)) throw new SessionScopeChangedError()
}
export function gateSnapshot() { return state }
export function subscribeGate(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function pauseRemote(mode: GateMode = 'checking', unavailable = false) {
  if (mode !== 'checking' || unavailable) streamRevocation++
  attempt++; state = { mode, scope: state.scope }; notify()
}
subscribeIdentity(() => { streamRevocation++; attempt++; state = { mode: identityOwner() ? 'checking' : 'signed-out', scope: null }; notify() })
export function beginVerification(owner: string): Verification {
  const scope = identityScope(owner); assertIdentity(scope)
  attempt++; state = { mode: 'checking', scope }; notify()
  return { ...scope, attempt }
}
export function assertVerification(value: Verification) {
  assertIdentity(value)
  if (value.attempt !== attempt) throw new SessionScopeChangedError()
}
export function finishVerification(value: Verification, mode: 'verified' | 'offline-known' | 'expired' | 'checking') {
  assertVerification(value)
  // A completed unsuccessful check differs from an ordinary check in flight.
  if (mode !== 'verified') streamRevocation++
  state = { mode, scope: value }; notify()
}
export class SessionGateError extends Error {
  readonly code = 'SESSION_NOT_VERIFIED'
  constructor() { super('账号尚未核验，远端操作暂不可用；本机内容与草稿仍保留') }
}
export function captureRemoteScope(expectedOwner?: string): RemoteScope {
  if (state.mode !== 'verified' || !state.scope) throw new SessionGateError()
  assertIdentity(state.scope)
  if (expectedOwner && state.scope.owner !== expectedOwner) throw new SessionScopeChangedError()
  return { ...state.scope, lease: attempt }
}
export function assertRemoteScope(scope: RemoteScope) {
  assertIdentity(scope)
  if (state.mode !== 'verified' || state.scope?.owner !== scope.owner || scope.lease !== attempt) throw new SessionGateError()
}
export function remoteReady(owner?: string) { try { captureRemoteScope(owner); return true } catch { return false } }

// Permits issued at a verified start survive only normal checking/renewal.
// HTTP/tool scopes retain their original stricter per-verification lease contract.
export function captureStreamScope(expectedOwner?: string): StreamScope {
  const verified = captureRemoteScope(expectedOwner)
  const scope = Object.freeze({ ...verified, asrOrigin: normalize(API_BASE_URL), revocation: streamRevocation })
  issuedStreamScopes.add(scope)
  return scope
}
export function assertStreamScope(scope: StreamScope) {
  assertIdentity(scope)
  if (!issuedStreamScopes.has(scope) || scope.revocation !== streamRevocation || scope.asrOrigin !== normalize(API_BASE_URL)
    || !state.scope || state.scope.owner !== scope.owner || !['verified', 'checking'].includes(state.mode)) throw new SessionGateError()
}
export function assertStreamResultScope(scope: StreamScope) {
  assertStreamScope(scope)
  if (state.mode !== 'verified') throw new SessionGateError()
}
