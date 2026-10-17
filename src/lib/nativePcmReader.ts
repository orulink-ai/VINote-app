import { NativeModules } from 'react-native'
import FS from 'react-native-fs'

type NativeReader = {
  openPcmReader(uri: string, start: number, end: number): Promise<string>
  readPcmReader(handle: string, position: number, bytes: number): Promise<string>
  closePcmReader(handle: string): Promise<void>
}

// Captured scope assertions are memory-only. Cleanup must work after scope loss.
export function createPcmReader(uri: string, start: number, end: number, assertCurrent: () => void) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || start % 2 || end % 2)
    throw new Error('PCM_INTERVAL_INVALID')
  const module = NativeModules.MeetingAudio as Partial<NativeReader> | undefined
  const native = module && typeof module.openPcmReader === 'function' && typeof module.readPcmReader === 'function'
    && typeof module.closePcmReader === 'function' ? module as NativeReader : undefined
  let opening: Promise<string> | undefined, closing: Promise<void> | undefined
  let stopped = false, reading = false, position = start
  const close = () => {
    stopped = true
    if (!closing) closing = (async () => {
      if (opening) {
        let handle: string
        try { handle = await opening } catch { return }
        await native!.closePcmReader(handle)
      }
    })()
    return closing
  }
  return {
    mode: native ? 'native-session' as const : 'legacy-rnfs' as const,
    close,
    async read(bytes: number) {
      if (reading) throw new Error("PCM_READ_CONCURRENT")
      reading = true
      try {
        assertCurrent()
        if (stopped || !Number.isInteger(bytes) || bytes < 2 || bytes > 6400 || bytes % 2 || bytes > end - position)
          throw new Error('PCM_READ_INVALID')
        let base64: string
        if (native) {
          // Assign pending open synchronously so cancellation waits for and closes a late handle.
          opening ||= native.openPcmReader(uri, start, end)
          const handle = await opening
          assertCurrent()
          if (stopped) throw new Error('PCM_READER_CLOSED')
          base64 = await native.readPcmReader(handle, position, bytes)
        } else {
          base64 = await FS.read(uri.replace('file://', ''), bytes, 44 + position, 'base64')
        }
        assertCurrent()
        if (stopped) throw new Error('PCM_READER_CLOSED')
        if (typeof base64 !== 'string' || base64.length !== 4 * Math.ceil(bytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
          || base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) !== bytes)
          throw new Error('PCM_READ_INCOMPLETE')
        position += bytes
        return base64
      } catch (error) {
        // A cleanup failure must not replace the original read/scope failure.
        try { await close() } catch { /* The first failure remains authoritative. */ }
        throw error
      } finally { reading = false }
    },
  }
}
