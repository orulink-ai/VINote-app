export function feishuExportSnapshot<T extends { title: string; content: string; transcript?: { full_text?: string } | null }>(
  note: T, snapshot?: { title: string; content: string }, includeTranscript = false,
): T {
  const frozen = snapshot || note
  const transcript = includeTranscript && note.transcript?.full_text
    ? `\n\n## ${snapshot ? '逐字稿（当前内容附件）' : '逐字稿'}\n\n${note.transcript.full_text}` : ''
  return { ...note, title: frozen.title, content: frozen.content + transcript }
}
