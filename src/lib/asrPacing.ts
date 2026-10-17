// Each packet's deadline comes from its PCM sample duration, including read/bridge work.
// Re-anchor every packet: suspension cannot build a backlog of catch-up sends.
export function createSampleClockPacer(now: () => number = () =>
  (globalThis as unknown as { performance?: { now(): number } }).performance?.now() ?? Date.now(),
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let lastClock = -Infinity
  const clock = () => {
    const value = now()
    if (!Number.isFinite(value)) throw new Error('PCM_CLOCK_INVALID')
    lastClock = Math.max(lastClock, value)
    return lastClock
  }
  return {
    begin(bytes: number) {
      if (!Number.isInteger(bytes) || bytes < 2 || bytes > 6400 || bytes % 2) throw new Error('PCM_FRAME_INVALID')
      const duration = bytes / 32 // 16kHz mono PCM16, milliseconds.
      const deadline = clock() + duration
      let waited = false
      return async () => {
        if (waited) throw new Error('PCM_PACE_DUPLICATE')
        waited = true
        let target = deadline
        // A read/send overrun must not produce an immediate catch-up packet.
        const completed = clock()
        if (completed >= target) target = completed + duration
        while (clock() < target) await sleep(target - clock())
      }
    },
  }
}
