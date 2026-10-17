export function formatDuration(seconds?: number | null) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '时长未知'
  const total = Math.floor(seconds), minutes = Math.floor(total / 60), remainder = String(total % 60).padStart(2, '0')
  return minutes < 60 ? `${minutes}:${remainder}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
}
