// Identity metadata only. Tokens remain exclusively in Keychain.
let epoch = 0
let owner: string | null | undefined
const listeners = new Set<() => void>()
export function identityEpoch() { return epoch }
export function identityOwner() { return owner }
export function adoptStoredIdentity(value: string) { if (owner === undefined) owner = value }
export function transitionIdentity(value: string | null) {
  epoch++; owner = value; listeners.forEach(listener => listener())
}
export function subscribeIdentity(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export class SessionScopeChangedError extends Error {
  readonly code = 'SESSION_SCOPE_CHANGED'
  constructor() { super('账号或服务已切换，原操作已停止；本机稿仍保留') }
}
