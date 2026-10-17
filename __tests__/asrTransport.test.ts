import { DeviceEventEmitter, NativeModules, Platform } from 'react-native'
import { createASRTransport, ASRTransportError } from '../src/lib/asrTransport'

const initialOS = Platform.OS
let id = ''
const module = {
  protocolVersion: 1,
  addListener: jest.fn(), removeListeners: jest.fn(),
  connect: jest.fn(async (value: string) => { id = value }),
  enqueue: jest.fn(async () => ({ accepted: true, queueBytes: 6420 })),
  close: jest.fn(async () => {}),
}
const event = (type: string, extra = {}) => DeviceEventEmitter.emit('VINoteASRTransport', { id, type, ...extra })
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  jest.clearAllMocks()
  module.connect.mockReset().mockImplementation(async (value: string) => { id = value })
  module.enqueue.mockReset().mockResolvedValue({ accepted: true, queueBytes: 6420 })
  module.close.mockReset().mockResolvedValue(undefined)
  NativeModules.VINoteASRTransport = module
})
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: initialOS })
  delete NativeModules.VINoteASRTransport
})

test('requires the installed native protocol, with no global RN socket fallback', () => {
  delete NativeModules.VINoteASRTransport
  expect(() => createASRTransport('wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2)).toThrow('更新 App')
})

test('awaits native ACK and preserves binary bytes without sending credentials in URL', async () => {
  let accept!: (ack: { accepted: boolean; queueBytes: number }) => void
  module.enqueue.mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
  const transport = createASRTransport('wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2)
  let settled = false
  const sent = transport.enqueue(new Uint8Array([0, 1, 2, 254, 255]).buffer).then(() => { settled = true })
  expect(settled).toBe(false)
  expect(module.enqueue.mock.calls[0]).toEqual([id, 'AAEC/v8=', true])
  expect(module.connect.mock.calls[0]).toEqual([id, 'wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2])
  accept({ accepted: true, queueBytes: 6420 }); await sent
  expect(transport.queuePeakBytes).toBe(6420)
  await transport.release()
})

test('false ACK terminates without retry and keeps the first safe failure', async () => {
  module.enqueue.mockResolvedValueOnce({ accepted: false, queueBytes: 0 })
  const transport = createASRTransport('wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2)
  const failed = jest.fn(); transport.onerror = failed
  await expect(transport.enqueue('start')).rejects.toMatchObject({ category: 1 })
  event('error', { category: 3, message: 'SYNTHETIC_SECRET' })
  await expect(transport.enqueue('start')).rejects.toMatchObject({ category: 1 })
  expect(module.enqueue).toHaveBeenCalledTimes(1)
  expect(failed.mock.calls).toEqual([[{ category: 1 }]])
  await transport.release()
})

test('peerClosing code remains distinct from failure category and does not revoke a pending true ACK', async () => {
  let accept!: (ack: { accepted: boolean; queueBytes: number }) => void
  module.enqueue.mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
  const transport = createASRTransport('wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2)
  const closed = jest.fn(), failed = jest.fn()
  transport.onclose = closed; transport.onerror = failed
  const pending = transport.enqueue(new Uint8Array([0, 0]).buffer)
  event('peerClosing', { code: 1000, category: 3, reason: 'SYNTHETIC_SECRET' })
  event('closed')
  expect(closed.mock.calls).toEqual([[{ code: 1000 }]])
  expect(failed).not.toHaveBeenCalled()
  accept({ accepted: true, queueBytes: 0 }); await pending
  await expect(transport.enqueue('late')).rejects.toMatchObject({ category: 1 })
  expect(module.enqueue).toHaveBeenCalledTimes(1)
  await transport.release()
})

test.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 999])('native category %s is allowlisted and raw errors never escape', async category => {
  const transport = createASRTransport('wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2)
  const failed = jest.fn(); transport.onerror = failed
  event('error', { category, message: 'SYNTHETIC_SECRET', token: 'SYNTHETIC_SECRET' })
  expect(failed.mock.calls).toEqual([[{ category: category <= 10 ? category : 0 }]])
  await expect(transport.enqueue('late')).rejects.toBeInstanceOf(ASRTransportError)
  expect(module.enqueue).not.toHaveBeenCalled()
  await transport.release()
})

test('release blocks late callbacks and waits for actual native termination', async () => {
  let closed!: () => void
  module.close.mockImplementationOnce(() => new Promise<void>(resolve => { closed = resolve }))
  const transport = createASRTransport('wss://api.orulink.ai/v1/asr/transcriptions', 'synthetic', 2)
  const message = jest.fn(), opened = jest.fn(), failed = jest.fn()
  transport.onmessage = message; transport.onopen = opened; transport.onerror = failed
  let settled = false
  const cleanup = transport.release().then(() => { settled = true })
  for (let i = 0; i < 10; i++) await Promise.resolve()
  event('message', { data: 'late' }); event('open'); event('error', { category: 3 })
  await expect(transport.enqueue('late')).rejects.toBeInstanceOf(ASRTransportError)
  expect(message).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled()
  expect(settled).toBe(false)
  closed(); await cleanup
  await transport.release()
  expect(module.close).toHaveBeenCalledTimes(1)
})
