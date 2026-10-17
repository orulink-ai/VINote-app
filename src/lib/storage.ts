import * as Keychain from 'react-native-keychain'
import { adoptStoredIdentity, transitionIdentity, identityEpoch, identityOwner, SessionScopeChangedError } from './sessionIdentity'

// Temporary development diagnostics. Never accept owner, content, path or error text.
type ReadStage = 'session.total' | 'session.queue' | 'session.keychain' | 'session.parse'
  | 'note.total' | 'note.prefix' | 'note.local_read' | 'note.workspace' | 'note.parse' | 'note.resolve'
  | 'workspace.total' | 'workspace.owner' | 'workspace.pointer' | 'workspace.pointer_parse'
  | 'workspace.file_read' | 'workspace.parse' | 'workspace.pointer_retry' | 'workspace.legacy_exists' | 'workspace.legacy_read'
  | 'detail.read' | 'detail.commit' | 'detail.refresh' | 'markdown.prepare' | 'markdown.render'
type ReadOutcome = 'ok' | 'empty' | 'failed' | 'discarded' | 'retry' | 'recovered'
let readSequence = 0
const readCounts: Partial<Record<ReadStage, number>> = {}
const readClock = () => {
  const clock = (globalThis as typeof globalThis & { performance?: { now: () => number } }).performance
  return clock ? clock.now() : Date.now()
}
// Explicit opt-in in the React Native development console; off on a new runtime.
// globalThis.VINOTE_READ_TIMING = true (set false when measurements are complete).
export function readTimingEnabled() {
  return __DEV__ && (globalThis as typeof globalThis & { VINOTE_READ_TIMING?: boolean }).VINOTE_READ_TIMING === true
}
function emitReadTiming(seq: number, stage: ReadStage, ms: number, count: number, outcome: ReadOutcome) {
  if (!readTimingEnabled()) return
  try {
    console.info(`[VINoteReadTiming] seq=${seq} stage=${stage} ms=${Math.max(0, ms).toFixed(1)} count=${count} outcome=${outcome}`)
  } catch { /* Diagnostics must never fail a business read. */ }
}
export function devReadTiming(stage: ReadStage): (outcome?: ReadOutcome) => void {
  if (!readTimingEnabled()) return () => {}
  const seq = ++readSequence, count = readCounts[stage] = (readCounts[stage] || 0) + 1
  const started = readClock()
  let ended = false
  return (outcome = 'ok') => {
    if (ended) return
    ended = true
    emitReadTiming(seq, stage, readClock() - started, count, outcome)
  }
}
export function devReadSync<T>(stage: ReadStage, action: () => T): T {
  const end = devReadTiming(stage)
  try { const value = action(); end(); return value }
  catch (cause) { end('failed'); throw cause }
}
export function devReadDuration(stage: ReadStage, ms: number) {
  if (!readTimingEnabled()) return
  emitReadTiming(++readSequence, stage, ms, readCounts[stage] = (readCounts[stage] || 0) + 1, 'ok')
}

// 与旧版电脑 API 凭证分开存储，避免将本地 JWT 发给云端。旧版录音保留。
const LEGACY_SERVICE = 'com.vinote.app.supabase.session'
const SERVICE = 'com.vinote.app.supabase.vinote.session'
export type Session = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string; email: string } }
let revision = 0
// 按调用顺序提交凭证变更，防止刷新写入晚于退出而恢复旧会话。
// Remove credentials issued by the previous Supabase project without touching recordings.
let mutations: Promise<unknown> = Promise.resolve()
  .then(() => Keychain.resetGenericPassword({ service: LEGACY_SERVICE }))
  .catch(() => {})
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = mutations.then(action)
  // Do not retain a resolved session in the shared queue or poison later reads.
  mutations = next.then(() => undefined, () => undefined)
  return next
}
function mutate(action: () => Promise<unknown>) {
  revision += 1
  return enqueue(action)
}
export function sessionRevision() { return revision }
export async function saveSession(session: Session, options?: { refresh: true; guard: () => void }) {
  options?.guard()
  if (!options?.refresh) transitionIdentity(session.user.id)
  await mutate(() => { options?.guard(); return Keychain.setGenericPassword(session.user.id, JSON.stringify(session), { service: SERVICE }) })
}
export async function readSession(): Promise<Session | null> {
  const epoch = identityEpoch(), owner = identityOwner()
  const assertScope = () => {
    if (identityEpoch() !== epoch || (owner !== undefined && identityOwner() !== owner))
      throw new SessionScopeChangedError()
  }
  const total = devReadTiming('session.total')
  let step = devReadTiming('session.queue')
  try {
    return await enqueue(async () => {
      step(); assertScope()
      step = devReadTiming('session.keychain')
      const credentials = await Keychain.getGenericPassword({ service: SERVICE })
      step(credentials ? 'ok' : 'empty'); assertScope()
      if (!credentials) { total('empty'); return null }
      let value: Session
      try { value = devReadSync('session.parse', () => JSON.parse(credentials.password)) }
      catch { total('failed'); return null }
      assertScope()
      const storedOwner = value?.user?.id
      if (typeof storedOwner !== 'string' || !storedOwner) { total('failed'); return null }
      const currentOwner = identityOwner()
      if (currentOwner !== undefined && currentOwner !== storedOwner) throw new SessionScopeChangedError()
      adoptStoredIdentity(storedOwner)
      assertScope(); total(); return value
    })
  } catch (cause) { step('failed'); total('failed'); throw cause }
}
export async function readAccountId() { return (await readSession())?.user.id || null }
export async function readToken() { return (await readSession())?.access_token || null }
export async function clearToken() {
  transitionIdentity(null)
  await mutate(async () => {
    await Keychain.resetGenericPassword({ service: SERVICE })
    await Keychain.resetGenericPassword({ service: LEGACY_SERVICE })
  })
}
