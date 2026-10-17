import { Platform } from 'react-native'
import { Buffer } from 'buffer'
import { recordedAudioPolicy, recordedAudioUsage } from '../src/lib/recordedAudioPolicy'
import { planRecordedInterval } from '../src/lib/recordedAudioPlanner'
import { createPcmReader } from '../src/lib/nativePcmReader'
jest.mock('../src/lib/nativePcmReader', () => ({ createPcmReader: jest.fn() }))
const policy = (bytes: unknown) => ({ capabilities: { recordedAudio: {
  protocol: 1, supported: true, strategy: 'adaptive_pause', maxSessionAudioBytes: bytes, policySource: 'service_budget',
} } })
test.each([640, 2097152, 64 * 1024 * 1024])('accepts service budget %s without model-name inference', bytes => {
  expect(recordedAudioPolicy(policy(bytes))?.maxSessionAudioBytes).toBe(bytes)
})
test.each([undefined, null, '2097152', 0, 639, 641, Infinity, 64 * 1024 * 1024 + 2])('rejects malformed budget %s', bytes => {
  expect(recordedAudioPolicy(policy(bytes))).toBeUndefined()
})
test('missing or future policy describes service method, never model incompatibility', () => {
  expect(recordedAudioPolicy({})).toBeUndefined()
  expect(recordedAudioPolicy({ capabilities: { recordedAudio: { ...policy(2097152).capabilities.recordedAudio, protocol: 2 } } })).toBeUndefined()
  expect(recordedAudioUsage({})).toContain('录音转写尚未就绪')
  expect(recordedAudioUsage(policy(2097152))).toContain('适用于录音与会议纪要')
  expect(recordedAudioUsage({})).not.toContain('模型不支持')
  expect(recordedAudioUsage(policy(2097152))).not.toMatch(/budget|预算|最低能量|PCM|协议/)
  expect(recordedAudioUsage(policy(2097152))).toContain('优先按停顿')
})
function pcm(amplitude: (frame: number) => number, frames: number, base = 0) {
  const bytes = Buffer.alloc(frames * 640)
  for (let i = 0; i < frames * 320; i++) bytes.writeInt16LE(amplitude(Math.floor(i / 320) + base), i * 2)
  return bytes
}
function reader(bytes: Buffer) {
  let cursor = 0
  const read = jest.fn(async (size: number) => {
    const part = bytes.subarray(cursor, cursor + size); cursor += size
    return Buffer.from(part).toString('base64')
  })
  const close = jest.fn(async () => {})
  jest.mocked(createPcmReader).mockImplementation((_uri, start, end) => {
    cursor = start; expect(end).toBeLessThanOrEqual(bytes.length)
    return { mode: 'native-session', read, close }
  })
  return { read, close }
}
beforeEach(() => jest.clearAllMocks())

test('chooses latest sustained relative quiet midpoint in final third using bounded PCM reads', async () => {
  const bytes = pcm(frame => frame >= 80 && frame < 96 ? 10 : 1000, 100), io = reader(bytes)
  const result = await planRecordedInterval('cache', 0, 4, 64000, async () => {})
  expect(result).toEqual({ end: 1.76, boundary: 'pause' })
  expect(io.read.mock.calls.every(([size]) => size <= 6400)).toBe(true)
})
test('continuous speech uses measured minimum-energy midpoint, never claims a pause', async () => {
  const io = reader(pcm(frame => frame === 90 ? 800 : 1000, 100))
  expect(await planRecordedInterval('cache', 0, 4, 64000, async () => {})).toEqual({ end: 1.81, boundary: 'energy' })
})
test('short quiet burst is not a sustained pause and nonzero offset stays sample aligned', async () => {
  reader(pcm(frame => frame >= 180 && frame < 185 ? 0 : 1000, 220))
  const result = await planRecordedInterval('cache', 2, 4.4, 64000, async () => {})
  expect(result.boundary).toBe('energy')
  expect(result.end).toBeGreaterThan(2)
  expect(Math.round(result.end * 32000) - 64000).toBeLessThanOrEqual(64000)
  expect(result.end * 16000).toBeCloseTo(Math.round(result.end * 16000))
})
test('final sample-exact remainder needs no scanning; invalid budgets fail closed', async () => {
  expect(await planRecordedInterval('cache', 1, 1 + 1 / 16000, 640, async () => {})).toEqual({ end: 1 + 1 / 16000, boundary: 'end' })
  expect(createPcmReader).not.toHaveBeenCalled()
  await expect(planRecordedInterval('cache', 0, 3, 641, async () => {})).rejects.toThrow()
})
test('guard/read failure aborts the bounded scan and never returns a fabricated boundary', async () => {
  const io = reader(pcm(() => 1000, 100))
  io.read.mockRejectedValueOnce(new Error('source unavailable'))
  await expect(planRecordedInterval('cache', 0, 4, 64000, async () => {})).rejects.toThrow('source unavailable')
})

test.each([640, 642, 1282, 2097152])('sample aligned even budget %s never overflows and cut remains in final third', async bytes => {
  const frames = Math.ceil(bytes / 640)
  reader(pcm(() => 1200, frames))
  const result = await planRecordedInterval('cache', 0, bytes / 32000 + 1, bytes, async () => {})
  expect(Math.round(result.end * 32000)).toBeLessThanOrEqual(bytes)
  expect(result.end * 32000).toBeGreaterThanOrEqual(bytes * 2 / 3 - 2)
  expect(result.boundary).toBe('energy')
})
test('latest qualifying quiet run wins over an earlier and longer quiet run', async () => {
  reader(pcm(frame => (frame >= 205 && frame < 225) || (frame >= 270 && frame < 283) ? 5 : 1000, 300))
  expect(await planRecordedInterval('cache', 0, 9, 192000, async () => {})).toEqual({ end: 5.53, boundary: 'pause' })
})

// Shared with the real Python planner; expected sample intervals were generated
// and checked using app/services/adaptive_asr_policy.py, not a TS reference clone.
const shared = require('./fixtures/recorded-audio-boundaries.json') as {
  cases: Array<{ name: string; budgetBytes: number; totalFrames: number; firstFrame: number; amplitude: number;
    overrides: number[][]; expectedFirstCut: number; expectedIntervals: number[][] }>
}
test.each(shared.cases)('shared Python PCM boundary fixture: $name', async fixture => {
  const bytes = Buffer.alloc(fixture.totalFrames * 2)
  for (let sample = 0; sample < fixture.totalFrames; sample++) {
    let amplitude = fixture.amplitude
    for (const [lo, hi, value] of fixture.overrides) if (sample >= lo && sample < hi) amplitude = value
    bytes.writeInt16LE(amplitude, sample * 2)
  }
  const io = reader(bytes), actual: number[][] = []
  let start = fixture.firstFrame
  while (start < fixture.totalFrames) {
    const result = await planRecordedInterval('cache', start / 16000, fixture.totalFrames / 16000, fixture.budgetBytes, async () => {})
    const end = Math.round(result.end * 16000)
    expect(end).toBeGreaterThan(start); expect((end - start) * 2).toBeLessThanOrEqual(fixture.budgetBytes)
    actual.push([start, end]); start = end
  }
  expect(actual).toEqual(fixture.expectedIntervals)
  expect(actual[0][1]).toBe(fixture.expectedFirstCut)
  expect(io.read.mock.calls.every(([length]) => length <= 6400)).toBe(true)
  if (fixture.name === 'final_exact_budget') expect(io.read).not.toHaveBeenCalled()
})
test('existing 6400B native bound preserves hops without bypassing resource-safe handles', async () => {
  const io = reader(pcm(frame => frame >= 250 && frame < 270 ? 0 : 1000, 400))
  expect(await planRecordedInterval('cache', 0, 8, 192000, async () => {})).toEqual({ end: 5.2, boundary: 'pause' })
  expect(io.read).toHaveBeenCalledTimes(30)
  expect(io.read.mock.calls.every(([count]) => count === 6400)).toBe(true)
  expect(io.close).toHaveBeenCalledTimes(1)
})
test('short batch and account cancellation cannot return a plausible fabricated pause', async () => {
  const io = reader(pcm(() => 1000, 100))
  io.read.mockResolvedValueOnce('AAA=')
  await expect(planRecordedInterval('cache', 0, 4, 64000, async () => {})).rejects.toThrow('PCM_SCAN_INCOMPLETE')
  const cancelled = reader(pcm(() => 1000, 400))
  let guards = 0
  await expect(planRecordedInterval('cache', 0, 8, 192000, async () => { if (++guards === 2) throw new Error('account changed') })).rejects.toThrow('account changed')
  expect(cancelled.read).toHaveBeenCalledTimes(1)
  expect(cancelled.close).toHaveBeenCalledTimes(1)
})


test('Android without native handles fails closed rather than using leaking RNFS.read', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android')
  const read = jest.fn(), close = jest.fn(async () => {})
  jest.mocked(createPcmReader).mockReturnValueOnce({ mode: 'legacy-rnfs', read, close })
  try {
    await expect(planRecordedInterval('cache', 0, 4, 64000, async () => {})).rejects.toThrow('安全的录音分窗读取能力')
    expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1)
  } finally { platform.restore() }
})
