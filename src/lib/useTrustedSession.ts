import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { readAccountId } from './storage'
import { beginVerification, assertVerification, identityScope, pauseRemote, type GateMode } from './sessionGate'
import { subscribeIdentity } from './sessionIdentity'
import { trustedLocalCache } from './ownerCacheScope'
import { verifySession } from './sessionVerifier'

export function useTrustedSession() {
  const [readable, setReadable] = useState<boolean | null>(null)
  const [mode, setMode] = useState<GateMode>('checking')
  const [message, setMessage] = useState('正在连接账号服务…')
  const [restartKey, setRestartKey] = useState(0)
  const retryRef = useRef<() => void>(() => {})
  const restart = useCallback(() => setRestartKey(value => value + 1), [])
  const showLogin = useCallback(() => { pauseRemote('expired'); setReadable(false) }, [])
  useEffect(() => {
    let active = true, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let originalOwner: string | null = null, sequence = 0
    const cancel = () => { sequence++; controller?.abort(); if (timer !== undefined) clearTimeout(timer); timer = undefined; pauseRemote() }
    const verify = async (automatic: boolean) => {
      cancel()
      const currentSequence = sequence
      try {
        const owner = await readAccountId()
        if (!active || sequence !== currentSequence) return
        if (!owner) { pauseRemote('signed-out'); setMode('signed-out'); setMessage(''); setReadable(false); return }
        if (originalOwner && owner !== originalOwner) { setReadable(false); restart(); return }
        originalOwner = owner
        const ticket = beginVerification(owner)
        const trusted = await trustedLocalCache(identityScope(owner)); assertVerification(ticket)
        if (!active || sequence !== currentSequence) return
        setMode('checking'); setMessage('正在连接账号服务…')
        if (trusted) setReadable(true)
        const current = new AbortController(); controller = current
        timer = setTimeout(() => current.abort(), 8000)
        const result = await verifySession(ticket, current.signal)
        assertVerification(ticket)
        if (!active || sequence !== currentSequence || controller !== current) return
        clearTimeout(timer); timer = undefined
        setMode(result)
        if (result === 'verified') {
          setReadable(true); setMessage('')
          // Authentication authorizes explicit services only; never starts content synchronization.
        } else if (result === 'expired') {
          setMessage('登录已过期，已保存内容不受影响。')
          setReadable(trusted)
        } else {
          setMessage(trusted ? '暂时无法连接账号服务，已保存内容仍可查看。' : '暂时无法连接账号服务，请稍后重试。')
          // No proof is not an empty library or a signed-out account.
          setReadable(trusted ? true : null)
        }
      } catch {
        // A canceled or superseded attempt cannot change another owner's UI.
        if (active && sequence === currentSequence) {
          pauseRemote('checking', true) // Failed/unknown verification cannot extend a running stream.
          setMessage('暂时无法连接账号服务，请稍后重试。')
        }
      }
    }
    retryRef.current = () => { void verify(false) }
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void verify(true)
      else { cancel(); if (active) { setMode('checking'); setMessage('正在连接账号服务…') } }
    })
    const identity = subscribeIdentity(() => {
      cancel(); if (active) { setReadable(false); restart() }
    })
    void verify(true)
    return () => { active = false; cancel(); identity(); appState.remove() }
  }, [restartKey, restart])
  return { readable, mode, message, retry: () => retryRef.current(), restart, showLogin }
}
