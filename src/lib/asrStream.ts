import { createSampleClockPacer } from './asrPacing'
import { ASRServiceFailure, withASRDiagnostic, type ASRDiagnostic } from './asrFailure'
import { captureStreamScope, assertStreamScope, assertStreamResultScope, subscribeGate, gateSnapshot, SessionGateError } from './sessionGate'
import { subscribeIdentity } from './sessionIdentity'
import { createPcmReader } from './nativePcmReader'
import { API_BASE_URL } from '../config/env'
import { accessToken } from './supabase'
import { TransportError } from './errors'
import { readSession } from './storage'
import { createASRTransport, ASRTransportError, safeTransportCategory } from './asrTransport'

export class ASRUnknownResult extends ASRServiceFailure {
  constructor(audioAttempted = true, sentComplete = false) { super('unknown_result', 'asr', audioAttempted, sentComplete) }
}

export class ASRSessionLimit extends Error {
  constructor(readonly seconds: number) { super('识别服务要求续接会话') }
}
export function durationLimit(event: { code?: string; message?: string; maxAudioDurationSeconds?: number }) {
  if (event.code !== 'audio_duration_exceeded') return undefined
  const match = event.message?.match(/(?:the\s+)?(\d+(?:\.\d+)?)\s+(second|minute)\s+session limit/i)
  const value = event.maxAudioDurationSeconds ?? (match ? Number(match[1]) * (match[2].toLowerCase() === 'minute' ? 60 : 1) : NaN)
  return Number.isFinite(value) && value > 0 ? value : undefined
}
export function pcmFrame(base64: string, sequence: number, first: boolean, last: boolean) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const length = base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  const frame = new Uint8Array(20 + length)
  frame.set([86, 76, 65, 50, 2, 1, (first ? 1 : 0) | (last ? 2 : 0), 0])
  const header = new DataView(frame.buffer)
  header.setUint32(8, sequence, true); header.setUint32(12, 0, true); header.setUint32(16, length, true)
  let bits = 0, value = 0, position = 20
  for (const char of base64) {
    if (char === '=') break
    const digit = alphabet.indexOf(char)
    if (digit < 0) throw new Error('音频帧格式无效')
    value = (value << 6) | digit; bits += 6
    if (bits >= 8) { bits -= 8; frame[position++] = (value >> bits) & 255 }
  }
  return frame.buffer
}

export async function recognizeInterval(wav: string, model: string, start: number, end: number,
  owner: string | undefined, guard: () => Promise<void>, progress: (seconds: number) => void, signal?: AbortSignal,
  onFailure?: (error: Error) => void) {
  await guard()
  const scope = captureStreamScope(owner)
  const assertCurrent = () => { assertStreamScope(scope); if (signal?.aborted) throw new Error('ASR_CANCELLED') }
  const session = await readSession()
  const token = await accessToken(!session?.expires_at || session.expires_at <= Date.now() / 1000 + 30, scope.owner)
  await guard()
  assertCurrent()
  assertStreamResultScope(scope) // A new socket requires current verified authorization.
  const reader = createPcmReader(wav, Math.round(start * 16000) * 2, Math.round(end * 16000) * 2, assertCurrent)
  const url = API_BASE_URL.replace(/^http/, 'ws') + '/v1/asr/transcriptions'
  return new Promise<string>((resolve, reject) => {
    const ws = createASRTransport(url, token, Math.round(end * 16000) * 2 - Math.round(start * 16000) * 2)
    let done = false, sending = false, sentComplete = false, finalPending = false, audioAttempted = false
    let lastEnqueuePending = false, pendingFinalText: string | undefined
    let submittedBytes = 0, submittedFrames = 0, nativeReadBytes = 0, nativeReadCount = 0
    const diagnostic = (error: Error, origin: NonNullable<ASRDiagnostic['origin']>, closeCode?: unknown, transportFailure?: number) =>
      withASRDiagnostic(error, { origin, closeCode, readerMode: reader.mode === 'native-session' ? 1 : 0,
        ...(ws.nativeAcknowledged ? { transportMode: 1, transportQueuePeakBytes: ws.queuePeakBytes } : {}),
        ...(transportFailure !== undefined ? { transportFailure } : {}),
        submittedBytes, submittedFrames, nativeReadBytes, nativeReadCount }, audioAttempted, sentComplete)
    let unsubscribeIdentity = () => {}, unsubscribeGate = () => {}
    let cancelFinalWait = () => {}
    const transportFailure = (message: string) => ws.nativeAcknowledged || audioAttempted
      ? new ASRUnknownResult(audioAttempted, sentComplete) : new TransportError(message)
    const deadlineMs = ((end - start) * 1.5 + 90) * 1000
    const expire = () => finish(diagnostic(transportFailure('转写等待超时，已完成识别保留'), 'deadline'))
    let timer = setTimeout(expire, deadlineMs)
    let finalizationDeadlineArmed = false
    const startFinalizationDeadline = () => {
      if (done || !sentComplete || finalizationDeadlineArmed) return
      finalizationDeadlineArmed = true
      // Upload and provider finalization each have a bounded budget. Only a
      // confirmed LAST enqueue starts the latter; partials never renew it.
      clearTimeout(timer)
      timer = setTimeout(expire, deadlineMs)
    }
    const abort = () => finish(new Error('ASR_CANCELLED'))
    const finish = (error?: Error, text?: string) => {
      if (done) return
      done = true; clearTimeout(timer); unsubscribeIdentity(); unsubscribeGate(); cancelFinalWait(); signal?.removeEventListener('abort', abort)
      let socketCleanup: Promise<void>
      try { socketCleanup = ws.release() } catch { socketCleanup = Promise.reject(new Error('ASR connection release unconfirmed')) }
      // Cleanup never needs authorization; accepting success still does.
      // allSettled keeps the lock until BOTH resources finish, even if one rejects.
      void Promise.allSettled([reader.close(), socketCleanup]).then(async results => {
        if (error) { reject(error); return }
        if (results[0].status === 'rejected') { reject(new Error('PCM_READER_CLOSE_FAILED')); return }
        if (results[1].status === 'rejected') { reject(new Error('ASR_TRANSPORT_CLOSE_FAILED')); return }
        try { await waitForVerifiedResult(); assertCurrent(); assertStreamResultScope(scope); resolve(text!) }
        catch (changed) { reject(changed) }
      })
      // Report the terminal failure without releasing the caller's resource lock.
      // The promise above still waits for cleanup, including a late native open.
      if (error && !(error instanceof ASRSessionLimit)) {
        try { assertCurrent(); onFailure?.(error) }
        catch { /* Scope loss/cancellation and observer errors cannot interrupt cleanup. */ }
      }
    }
    const invalidate = () => { try { assertCurrent() } catch (error) { finish(error instanceof Error ? error : new SessionGateError()) } }
    unsubscribeIdentity = subscribeIdentity(invalidate)
    unsubscribeGate = subscribeGate(invalidate)
    signal?.addEventListener('abort', abort, { once: true })
    invalidate()
    const waitForVerifiedResult = () => new Promise<void>((allow, deny) => {
      let settled = false
      let unsubscribe = () => {}
      let timeout: ReturnType<typeof setTimeout> | undefined
      const settle = (error?: Error) => {
        if (settled) return
        settled = true; unsubscribe(); if (timeout !== undefined) clearTimeout(timeout)
        cancelFinalWait = () => {}
        if (error) deny(error); else allow()
      }
      const check = () => {
        try { assertCurrent(); if (gateSnapshot().mode === 'verified') { assertStreamResultScope(scope); settle() } }
        catch (error) { settle(error instanceof Error ? error : new SessionGateError()) }
      }
      unsubscribe = subscribeGate(check)
      timeout = setTimeout(() => settle(new SessionGateError()), 10000)
      cancelFinalWait = () => settle(new SessionGateError())
      check()
    })
    const acceptFinal = (text: string) => {
      if (done || !sentComplete) return
      finalPending = true; clearTimeout(timer)
      void waitForVerifiedResult().then(async () => {
        await guard(); assertStreamResultScope(scope); finish(undefined, text)
      }).catch(error => finish(error))
    }
    const send = async () => {
      try {
        let position = Math.round(start * 16000) * 2
        const last = Math.round(end * 16000) * 2
        let sequence = 0
        const pacer = createSampleClockPacer()
        while (!done && position < last) {
          assertCurrent()
          if (done) return
          const bytes = Math.min(6400, last - position)
          const waitForSampleDeadline = pacer.begin(bytes)
          let base64: string
          try { base64 = await reader.read(bytes) }
          catch (error) {
            // Identity/cancellation failures remain identity/cancellation, never transport failures.
            assertCurrent()
            throw diagnostic(error instanceof Error ? error : new Error('音频读取失败'), 'send_error')
          }
          assertCurrent()
          if (done) return
          if (reader.mode === 'native-session') { nativeReadBytes += bytes; nativeReadCount++ }
          const frame = pcmFrame(base64, sequence, sequence === 0, position + bytes === last)
          if (frame.byteLength !== 20 + bytes) throw new Error('音频读取不完整，请检查原文件后重试')
          audioAttempted = true // A throwing bridge send has an unknown remote outcome.
          lastEnqueuePending = position + bytes === last
          try { await ws.enqueue(frame) }
          catch (error) { throw diagnostic(new ASRUnknownResult(audioAttempted, sentComplete), 'send_error', undefined,
            error instanceof ASRTransportError ? error.category : undefined) }
          finally { lastEnqueuePending = false }
          assertCurrent()
          if (done) return
          // Android counts true native enqueue ACKs; neither mode proves provider recognition.
          submittedBytes += bytes; submittedFrames++
          sequence++; position += bytes
          if (position === last) { sentComplete = true; startFinalizationDeadline() }
          if (sentComplete && pendingFinalText !== undefined) acceptFinal(pendingFinalText)
          // Pace each packet independently. App suspension or slow file reads
          // must not cause a burst of catch-up packets on resuming.
          if (!sentComplete) await waitForSampleDeadline()
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('音频读取失败')) }
    }
    ws.onopen = () => {
      if (done) return
      try { assertStreamResultScope(scope) }
      catch (error) { finish(error instanceof Error ? error : new SessionGateError()); return }
      try { void ws.enqueue(JSON.stringify({ type: 'session.start', model,
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 } })).catch(error => finish(diagnostic(
          ws.nativeAcknowledged ? new ASRUnknownResult(audioAttempted, sentComplete) : transportFailure('转写连接中断，已完成识别保留'),
          'send_error', undefined, error instanceof ASRTransportError ? error.category : undefined))) }
      catch (error) { finish(diagnostic(error instanceof Error ? error : new SessionGateError(), 'send_error')) }
    }
    ws.onerror = event => { if (!finalPending || !sentComplete) finish(diagnostic(
      ws.nativeAcknowledged ? new ASRUnknownResult(audioAttempted, sentComplete) : transportFailure('转写连接中断，已完成识别保留'),
      'socket_error', undefined, event ? safeTransportCategory(event.category) : undefined)) }
    ws.onclose = event => {
      // A final may precede the bridge's ACK for an already-enqueued LAST.
      // A normal peer close cannot revoke that ACK; the original deadline still applies.
      if (finalPending && lastEnqueuePending) return
      if (!done && (!finalPending || !sentComplete)) finish(diagnostic(transportFailure('转写连接关闭，未保存临时文字'), 'socket_close', event?.code))
    }
    ws.onmessage = event => {
      if (done) return
      try {
        assertCurrent()
        const message = JSON.parse(String(event.data))
        if (message.type === 'session.started' && !sending) { sending = true; void send() }
        if (message.type === 'asr.partial' && typeof message.audioMs === 'number' && Number.isFinite(message.audioMs) && message.audioMs >= 0)
          progress(Math.min(end - start, message.audioMs / 1000))
        if (message.type === 'asr.final' && !finalPending) {
          if (!sentComplete && !lastEnqueuePending) finish(new Error('音频尚未发送完整，不能保存提前返回的结果'))
          else if (typeof message.text !== 'string') finish(new Error('转写结果格式异常'))
          else {
            if (sentComplete) acceptFinal(message.text.trim())
            else { finalPending = true; pendingFinalText = message.text.trim() } // Keep deadline until this LAST gets a true ACK.
          }
        }
        if (message.type === 'error' || message.type === 'session.error') {
          if (message.code === 'unknown_result') { finish(diagnostic(new ASRUnknownResult(audioAttempted, sentComplete), 'server_error')); return }
          const limit = durationLimit(message)
          finish(diagnostic(limit ? new ASRSessionLimit(limit) : new ASRServiceFailure(message.code, message.stage, audioAttempted, sentComplete), 'server_error'))
        }
      } catch (error) { finish(error instanceof Error ? error : new Error('转写服务返回格式异常')) }
    }
  })
}
