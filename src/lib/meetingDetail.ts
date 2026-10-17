export function transcriptChapters(transcript: string) {
  const chapters: { seconds: number; text: string }[] = []
  const chunks = transcript.split(/\[录音第 (\d+) 分钟起\]\n/)
  for (let index = 1; index < chunks.length; index += 2) {
    chapters.push({
      seconds: Number(chunks[index]) * 60,
      text: chunks[index + 1] || '',
    })
  }
  return chapters
}

export function formatSpeakerOffset(seconds: number) {
  const tenths = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds * 10)) : 0
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`
}
