type RecordRef = { id: string; noteId?: string }
type NoteRef = { id: string; task_id?: string | null }

/** A title or date is never evidence that a note belongs to a recording. */
export function planMeetingDeletion(record: RecordRef, notes: NoteRef[]): string[] {
  if (!/^[a-z0-9-]+$/i.test(record.id)) throw new Error('会议标识无效')
  const pointer = record.noteId && notes.find(note => note.id === record.noteId)
  if (pointer && pointer.task_id !== record.id) throw new Error('纪要与录音的关联不一致，请先核对后再删除')
  return [...new Set(notes.filter(note => note.task_id === record.id).map(note => note.id))]
}
