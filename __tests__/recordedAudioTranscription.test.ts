import { Buffer } from 'buffer'
import { NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { transcribe, type TranscriptionCheckpoint } from '../src/lib/meetingCloud'
import { recognizeInterval } from '../src/lib/asrStream'
import { loadModels } from '../src/lib/models'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { beginVerification, finishVerification } from '../src/lib/sessionGate'
jest.mock('../src/lib/asrStream', () => ({ recognizeInterval: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadModels: jest.fn() }))
const source = { size: 99999, modifiedMs: 1700000000000 }, model = 'opaque-any-provider'
const budget = 2097152
const catalog = (bytes = budget) => [{ id: model, modelType: 'asr' as const, runtimeStatus: 'available', capabilities: { recordedAudio: {
  protocol: 1, supported: true, strategy: 'adaptive_pause', maxSessionAudioBytes: bytes, policySource: 'service_budget',
} } }]
let duration: number, readCount: number, maxRead: number
function options(checkpoint?: TranscriptionCheckpoint) {
  return { owner: 'A', checkpoint, guard: jest.fn(async () => {}), progress: jest.fn(), save: jest.fn(async (_cp: TranscriptionCheckpoint) => {}) }
}
beforeEach(() => {
  jest.clearAllMocks(); duration = 1376.5485625; readCount = 0; maxRead = 0
  transitionIdentity('A'); finishVerification(beginVerification('A'), 'verified')
  jest.mocked(loadModels).mockResolvedValue(catalog())
  jest.mocked(recognizeInterval).mockReset().mockResolvedValue('synthetic confirmed text')
  jest.mocked(FS.stat).mockResolvedValue({ size: source.size, mtime: new Date(source.modifiedMs) } as never)
  const handles = new Map<string, { position: number; end: number }>(); let serial = 0
  NativeModules.MeetingAudio = {
    toWav: jest.fn(async () => 'file:///cache/asr-test.wav'), wavInfo: jest.fn(async () => duration),
    openPcmReader: async (_uri: string, start: number, end: number) => { const id = String(++serial); handles.set(id, { position: start, end }); return id },
    readPcmReader: async (id: string, position: number, bytes: number) => {
      const h = handles.get(id)!
      expect(position).toBe(h.position); expect(position + bytes).toBeLessThanOrEqual(h.end)
      readCount++; maxRead = Math.max(maxRead, bytes)
      const pcm = Buffer.alloc(bytes)
      for (let i = 0; i < bytes; i += 2) {
        const seconds = (position + i) / 32000
        pcm.writeInt16LE(seconds % 50 >= 48 ? 0 : 1000, i)
      }
      h.position += bytes; return pcm.toString('base64')
    },
    closePcmReader: async (id: string) => { handles.delete(id) },
  }

})
test('22m57s policy plans contiguous sample-exact sessions within budget and saves finals only', async () => {
  const o = options(); await transcribe('file:///original', model, o)
  const calls = jest.mocked(recognizeInterval).mock.calls
  expect(calls.length).toBeGreaterThan(20)
  let previous = 0
  for (const args of calls) {
    expect(args[1]).toBe(model); expect(args[2]).toBe(previous)
    expect(Math.round(args[3] * 16000) * 2 - Math.round(args[2] * 16000) * 2).toBeLessThanOrEqual(budget)
    expect(args[3]).toBeGreaterThan(args[2]); previous = args[3]
  }
  expect(previous).toBe(duration)
  expect(o.progress).toHaveBeenCalledWith('正在整理音频分段')
  expect(o.progress.mock.calls.flat().join(' ')).not.toMatch(/预算|最低能量|budget|PCM/)
  expect(maxRead).toBeLessThanOrEqual(6400); expect(readCount).toBeGreaterThan(0)
  const cp = o.save.mock.calls.at(-1)![0]
  expect(cp.version === 5 && cp.intervals.length).toBe(calls.length)
  expect(cp).not.toHaveProperty('inFlight')
  expect(o.save.mock.calls.every(([value]) => value.version === 5 && value.intervals.every(part => part.text === 'synthetic confirmed text'))).toBe(true)
})
test('missing policy blocks before any checkpoint replacement or audio submission', async () => {
  jest.mocked(loadModels).mockResolvedValue([{ id: model, modelType: 'asr', runtimeStatus: 'available' }])
  const checkpoint: TranscriptionCheckpoint = { version: 5, model, duration, source, intervals: [{ start: 0, end: 50, text: 'retained' }] }
  const before = JSON.stringify(checkpoint), o = options(checkpoint)
  await expect(transcribe('file:///original', model, o)).rejects.toThrow('录音转写尚未就绪')
  expect(recognizeInterval).not.toHaveBeenCalled(); expect(o.save).not.toHaveBeenCalled(); expect(readCount).toBe(0)
  expect(JSON.stringify(checkpoint)).toBe(before)
})
test('second-session unknown preserves first final and durable marker; recovery never calls service or saves', async () => {
  duration = 140
  jest.mocked(recognizeInterval).mockResolvedValueOnce('first final').mockRejectedValueOnce(new Error('unknown_result'))
  const o = options(); await expect(transcribe('file:///original', model, o)).rejects.toThrow('unknown_result')
  expect(recognizeInterval).toHaveBeenCalledTimes(2)
  const cp = o.save.mock.calls.at(-1)![0]
  expect(cp).toMatchObject({ intervals: [{ start: 0, text: 'first final' }], inFlight: expect.any(Object) })
  const recovery = options(cp), saved = JSON.stringify(cp)
  jest.mocked(recognizeInterval).mockClear(); jest.mocked(loadModels).mockClear()
  await expect(transcribe('file:///original', model, recovery)).rejects.toThrow('尚未确认')
  expect(recognizeInterval).not.toHaveBeenCalled(); expect(loadModels).not.toHaveBeenCalled(); expect(recovery.save).not.toHaveBeenCalled()
  expect(JSON.stringify(cp)).toBe(saved)
})
test('complete historical v5 result does not require new policy; incomplete success resumes only its gap', async () => {
  duration = 100
  const cp: TranscriptionCheckpoint = { version: 5, model, duration, source, intervals: [{ start: 0, end: duration, text: 'retained final' }] }
  await expect(transcribe('file:///original', model, options(cp))).resolves.toContain('retained final')
  expect(loadModels).not.toHaveBeenCalled(); expect(recognizeInterval).not.toHaveBeenCalled()
  const incomplete = { ...cp, intervals: [{ start: 0, end: 80, text: 'retained final' }] }
  await transcribe('file:///original', model, options(incomplete))
  expect(recognizeInterval).toHaveBeenCalledTimes(1)
  expect(jest.mocked(recognizeInterval).mock.calls[0].slice(1, 4)).toEqual([model, 80, 100])
  expect(incomplete.intervals).toEqual([{ start: 0, end: 80, text: 'retained final' }])
})
test('failed attempt-marker write cannot dispatch audio; source mismatch preserves history', async () => {
  duration = 5
  const o = options(); o.save.mockImplementation(async cp => { if (cp.version === 5 && cp.inFlight) throw new Error('disk full') })
  await expect(transcribe('file:///original', model, o)).rejects.toThrow('disk full')
  expect(recognizeInterval).not.toHaveBeenCalled()
  const mismatch = options({ version: 5, model: 'previous', duration, source, intervals: [{ start: 0, end: 5, text: 'old' }] })
  await expect(transcribe('file:///original', model, mismatch)).rejects.toThrow('不一致')
  expect(mismatch.save).not.toHaveBeenCalled()
})
