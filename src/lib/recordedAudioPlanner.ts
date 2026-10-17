import { Platform } from 'react-native'
import { createPcmReader } from './nativePcmReader'
import { validAudioBudget } from './recordedAudioPolicy'
const RATE = 16000, FRAME_SAMPLES = 320, FRAME_BYTES = FRAME_SAMPLES * 2
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodePCM(base64: string, length: number) {
  if (typeof base64 !== 'string' || base64.length !== 4 * Math.ceil(length / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) ||
    base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) !== length)
    throw new Error('PCM_SCAN_INCOMPLETE')
  const bytes = new Uint8Array(length)
  let bits = 0, value = 0, position = 0
  for (const char of base64) {
    if (char === '=') break
    const digit = alphabet.indexOf(char)
    if (digit < 0) throw new Error('PCM_SCAN_INVALID')
    value = (value << 6) | digit; bits += 6
    if (bits >= 8) { bits -= 8; bytes[position++] = (value >> bits) & 255 }
  }
  if (position !== length) throw new Error('PCM_SCAN_INCOMPLETE')
  return new DataView(bytes.buffer)
}
/** Single-pass Python-compatible acoustic planning through the existing reader.
 * Android requires the bounded native handle: installed RNFS.read leaks its input
 * stream, so it cannot safely be used to bypass the native 6400B read ceiling.
 * No new native interface, whole-file read, tail array or second pass.
 */
export async function planRecordedInterval(wav: string, start: number, gapEnd: number, budget: number, guard: () => Promise<void>) {
  if (!validAudioBudget(budget) || !Number.isFinite(start) || !Number.isFinite(gapEnd) || start < 0 || gapEnd <= start)
    throw new Error('录音分段预算或区间无效，未提交音频')
  const first = Math.round(start * RATE), last = Math.round(gapEnd * RATE)
  const limit = Math.min(last, first + budget / 2)
  if (limit <= first) throw new Error('录音分段区间不足一个采样，未提交音频')
  if (limit === last) return { end: last / RATE, boundary: 'end' as const }
  const reader = createPcmReader(wav, first * 2, limit * 2, () => {})
  if (Platform.OS === 'android' && reader.mode !== 'native-session') {
    await reader.close()
    throw new Error('当前安装包缺少安全的录音分窗读取能力，请更新App；原录音保留')
  }
  const search = first + Math.floor((budget / 2) * 2 / 3)
  let peak = 0, position = first, runStart: number | undefined, bestPause: number | undefined
  let quietest = Infinity, quietestAt = limit
  try {
  while (position < limit) {
    await guard()
    // 6400 is a multiple of the 640B analysis hop: batch boundaries cannot
    // split a hop. Only the final hop at the candidate cap can be shorter.
    const count = Math.min(6400, (limit - position) * 2)
    const pcm = decodePCM(await reader.read(count), count)
    await guard()
    for (let offset = 0; offset < count; offset += FRAME_BYTES) {
      const length = Math.min(FRAME_BYTES, count - offset)
      let energy = 0
      for (let i = offset; i < offset + length; i += 2) { const sample = pcm.getInt16(i, true); energy += sample * sample }
      energy /= length / 2
      peak = Math.max(peak, energy)
      const frameStart = position + offset / 2, end = frameStart + length / 2
      const quiet = energy <= Math.max(64, peak * .001)
      if (frameStart >= search) {
        if (energy <= quietest) { quietest = energy; quietestAt = frameStart + Math.floor(length / 4) }
        runStart = quiet ? runStart ?? frameStart : undefined
        if (runStart !== undefined && end - runStart >= 12 * FRAME_SAMPLES) bestPause = Math.floor((runStart + end) / 2)
      }
    }
    position += count / 2
  }
  } finally { await reader.close() }
  await guard()
  const boundary = Math.max(first + 1, Math.min(limit, bestPause ?? quietestAt))
  return { end: boundary / RATE, boundary: bestPause !== undefined ? 'pause' as const : 'energy' as const }
}
