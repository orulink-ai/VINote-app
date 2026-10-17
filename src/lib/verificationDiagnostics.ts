import { ApiError } from './errors'
import { safeSupabaseAuthCode } from './supabaseAuthCode'

type Stage = 'verify' | 'session_read' | 'user_http' | 'refresh_http' | 'decode' | 'credential_save' | 'owner_read' | 'proof_save'
type Outcome = 'start' | 'ok' | 'http' | 'deadline' | 'transport' | 'storage' | 'scope_changed' | 'failed'
export type VerificationTrace = (stage: Stage, outcome: Outcome, status?: number, errorCode?: unknown) => void
let sequence = 0
export function verificationDiagnosticsEnabled() {
  return __DEV__ && (globalThis as typeof globalThis & { VINOTE_VERIFY_DIAGNOSTICS?: boolean }).VINOTE_VERIFY_DIAGNOSTICS === true
}
export function verificationTrace(): VerificationTrace | undefined {
  if (!verificationDiagnosticsEnabled()) return
  const seq = ++sequence, started = Date.now()
  return (stage, outcome, status, errorCode) => {
    if (!verificationDiagnosticsEnabled()) return
    const code = Number.isInteger(status) && status! >= 100 && status! <= 599 ? ` status=${status}` : ''
    const category = outcome === 'http' && status && status >= 400 ? ` code=${safeSupabaseAuthCode(errorCode)}` : ''
    try { console.info(`[VINoteVerify] seq=${seq} stage=${stage} ms=${Math.max(0, Date.now() - started)} outcome=${outcome}${code}${category}`) } catch { /* Optional diagnostics never affect verification. */ }
  }
}
export function verificationFailure(error: unknown, aborted: boolean): Outcome {
  if (aborted) return 'deadline'
  if ((error as { code?: string } | null)?.code === 'SESSION_SCOPE_CHANGED') return 'scope_changed'
  if (error instanceof ApiError) return 'http'
  if (error instanceof TypeError) return 'transport'
  return 'failed'
}
