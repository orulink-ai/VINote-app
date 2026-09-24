export function recordingElapsedSeconds(startedAtMs: number, nowMs: number, previousSeconds: number): number {
  const previous = Number.isFinite(previousSeconds) ? Math.max(0, previousSeconds) : 0
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return previous
  return Math.max(previous, Math.floor((nowMs - startedAtMs) / 1000))
}
