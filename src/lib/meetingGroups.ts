import type { Note } from '../types/api'

/** Evidence comes only from the current account's stored original associations. */
export type MeetingSource = { owner: string; noteId: string; kind: 'recording' | 'file'; sourceId: string }
export type MeetingGroup = { id: string; meetingGroup: true; notes: Note[] }
export type MeetingRow = Note | MeetingGroup
export function isMeetingGroup(row: MeetingRow): row is MeetingGroup { return 'meetingGroup' in row }

/** Display only: no content/version identity changes and no transitive merging. */
export function groupMeetings(notes: Note[], owner: string, sources: MeetingSource[]): MeetingRow[] {
  const bindings = new Map<string, Set<string>>()
  for (const source of sources) {
    if (!owner || source.owner !== owner || !source.sourceId || !source.noteId) continue
    const keys = bindings.get(source.noteId) || new Set<string>()
    keys.add(JSON.stringify([owner, source.kind, source.sourceId]))
    bindings.set(source.noteId, keys)
  }
  const groups = new Map<string, MeetingGroup>(), result: MeetingRow[] = []
  for (const note of notes) {
    if (note.deleted) continue
    const keys = bindings.get(note.id)
    const key = (note.source_type || '').startsWith('meeting') && keys?.size === 1 ? [...keys][0] : undefined
    if (!key) { result.push(note); continue }
    let group = groups.get(key)
    if (!group) {
      group = { id: `meeting-source:${key}`, meetingGroup: true, notes: [] }
      groups.set(key, group); result.push(group)
    }
    group.notes.push(note)
  }
  return result.map(row => isMeetingGroup(row) && row.notes.length === 1 ? row.notes[0] : row)
}
