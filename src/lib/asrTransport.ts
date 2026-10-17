import { NativeEventEmitter, NativeModules, Platform } from 'react-native'

type NativeTransport = {
  protocolVersion: number
  connect(id: string, url: string, token: string, bytes: number): Promise<void>
  enqueue(id: string, data: string, binary: boolean): Promise<{ accepted: boolean; queueBytes: number }>
  close(id: string): Promise<void>
}
export type TransportFailure = { category: number }
export type ASRTransport = {
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: (event?: TransportFailure) => void
  onclose?: (event?: { code?: number }) => void
  enqueue(data: string | ArrayBuffer): Promise<void>
  release(): Promise<void>
  readonly nativeAcknowledged: boolean
  readonly queuePeakBytes: number
}
export function safeTransportCategory(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : 0
}
export class ASRTransportError extends Error {
  constructor(readonly category: number) { super('ASR transport failed; original retained') }
}
function categoryFromRejection(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  const match = typeof code === 'string' ? /^ASR_TRANSPORT_(\d+)$/.exec(code) : null
  return safeTransportCategory(match ? Number(match[1]) : 0)
}
function base64(buffer: ArrayBuffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes = new Uint8Array(buffer)
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    result += alphabet[n >>> 18] + alphabet[(n >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=')
      + (i + 2 < bytes.length ? alphabet[n & 63] : '=')
  }
  return result
}
let sequence = 0
export function createASRTransport(url: string, token: string, expectedBytes: number): ASRTransport {
  if (Platform.OS !== 'android') {
    // iOS retains its existing implementation; these returns are bridge submissions, not native ACKs.
    const ws = new WebSocket(url, undefined, { headers: { Authorization: `Bearer ${token}` } } as never)
    return Object.assign(ws, {
      nativeAcknowledged: false, queuePeakBytes: 0,
      enqueue: async (data: string | ArrayBuffer) => { ws.send(data) },
      release: async () => { ws.close() },
    }) as unknown as ASRTransport
  }
  const module = NativeModules.VINoteASRTransport as NativeTransport | undefined
  if (!module || module.protocolVersion !== 1 || !module.connect || !module.enqueue || !module.close)
    throw new Error('当前安装包缺少转写传输确认能力，请更新 App；原录音和已保存进度保留')
  const id = `asr-${Date.now()}-${++sequence}`
  let stopped = false, peerClosing = false, firstFailure: number | undefined, queuePeakBytes = 0
  let closing: Promise<void> | undefined
  const reportFailure = (category: number) => {
    if (stopped || firstFailure !== undefined) return
    firstFailure = safeTransportCategory(category)
    transport.onerror?.({ category: firstFailure })
  }
  const transport: ASRTransport = {
    nativeAcknowledged: true,
    get queuePeakBytes() { return queuePeakBytes },
    async enqueue(data) {
      if (stopped || peerClosing || firstFailure !== undefined) throw new ASRTransportError(firstFailure ?? (peerClosing ? 1 : 0))
      try {
        const ack = await module.enqueue(id, typeof data === 'string' ? data : base64(data), typeof data !== 'string')
        if (!ack || ack.accepted !== true || !Number.isSafeInteger(ack.queueBytes) || ack.queueBytes < 0 || ack.queueBytes > 65536)
          throw new ASRTransportError(1)
        queuePeakBytes = Math.max(queuePeakBytes, ack.queueBytes)
        if (stopped || firstFailure !== undefined) throw new ASRTransportError(firstFailure ?? 0)
      } catch (error) {
        const category = error instanceof ASRTransportError ? error.category : categoryFromRejection(error)
        reportFailure(category)
        throw new ASRTransportError(firstFailure ?? category)
      }
    },
    release() {
      stopped = true // Blocks late events and enqueue before native teardown runs.
      closing ||= connected.catch(() => {}).then(() => module.close(id)).finally(() => subscription.remove())
      return closing
    },
  }
  const subscription = new NativeEventEmitter(NativeModules.VINoteASRTransport).addListener('VINoteASRTransport', raw => {
    const event = raw as { id?: unknown; type?: unknown; category?: unknown; data?: unknown; code?: unknown }
    if (event.id !== id || stopped) return
    if (event.type === 'open' && firstFailure === undefined) transport.onopen?.()
    if (event.type === 'message' && firstFailure === undefined && typeof event.data === 'string') transport.onmessage?.({ data: event.data })
    if (event.type === 'error') reportFailure(safeTransportCategory(event.category))
    if (event.type === 'peerClosing' && !peerClosing && firstFailure === undefined) {
      peerClosing = true
      const code = typeof event.code === 'number' && Number.isInteger(event.code) && event.code >= 1000 && event.code <= 4999 ? event.code : 1006
      transport.onclose?.({ code })
    }
    if (event.type === 'closed' && !peerClosing && firstFailure === undefined) transport.onclose?.({ code: 1006 })
  })
  const connected = module.connect(id, url, token, expectedBytes)
  void connected.catch(error => reportFailure(categoryFromRejection(error)))
  return transport
}
