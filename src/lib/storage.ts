import * as Keychain from 'react-native-keychain'

// 与旧版电脑 API 凭证分开存储，避免将本地 JWT 发给云端。旧版录音保留。
const SERVICE = 'com.vinote.app.supabase.session'
export type Session = { access_token: string; refresh_token: string; user: { id: string; email: string } }
let revision = 0
// 按调用顺序提交凭证变更，防止刷新写入晚于退出而恢复旧会话。
let mutations: Promise<unknown> = Promise.resolve()
function mutate(action: () => Promise<unknown>) {
  revision += 1
  const next = mutations.then(action)
  mutations = next.catch(() => {})
  return next
}
export function sessionRevision() { return revision }
export async function saveSession(session: Session) {
  await mutate(() => Keychain.setGenericPassword(session.user.id, JSON.stringify(session), { service: SERVICE }))
}
export async function readSession(): Promise<Session | null> {
  await mutations
  const credentials = await Keychain.getGenericPassword({ service: SERVICE })
  if (!credentials) return null
  try { return JSON.parse(credentials.password) } catch { return null }
}
export async function readAccountId() { return (await readSession())?.user.id || null }
export async function readToken() { return (await readSession())?.access_token || null }
export async function clearToken() {
  await mutate(() => Keychain.resetGenericPassword({ service: SERVICE }))
}
