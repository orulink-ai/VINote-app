import { groupMeetings, type MeetingSource } from '../src/lib/meetingGroups'
import type { Note } from '../src/types/api'

const note = (id: string, extra: Partial<Note> = {}): Note => ({ id, title: '同名会议', content: `完整正文-${id}`, source_type: 'meeting_recording', status: 'done', created_at: '2026-10-20', updated_at: '2026-10-20', ...extra })
const source = (noteId: string, extra: Partial<MeetingSource> = {}): MeetingSource => ({ owner: 'owner-a', noteId, kind: 'recording', sourceId: 'meeting-001', ...extra })

test('groups only explicit same-owner originals, preserving exact bodies and input order', () => {
  const a = note('a'), b = note('b'), c = note('c')
  const result = groupMeetings([a, c, b], 'owner-a', [source('a'), source('b')])
  expect(result).toEqual([{ id: expect.any(String), meetingGroup: true, notes: [a, b] }, c])
  expect(a.content).toBe('完整正文-a')
})
test('same title/time/task without source proof, other owner and non-meetings stay separate', () => {
  const notes = [note('a', { task_id: 'same' }), note('b', { task_id: 'same' }), note('c', { source_type: 'text' })]
  expect(groupMeetings(notes, 'owner-a', [source('a'), source('b', { owner: 'owner-b' }), source('c')])).toEqual(notes)
  expect(groupMeetings(notes, '', [source('a'), source('b')])).toEqual(notes)
})
test('conflicting bindings cannot bridge two originals; file and recording namespaces differ', () => {
  const notes = ['a', 'b', 'c', 'd'].map(id => note(id))
  expect(groupMeetings(notes, 'owner-a', [source('a'), source('b'), source('b', { sourceId: 'other' }), source('c', { sourceId: 'other' }), source('d', { kind: 'file' })])).toEqual(notes)
})
test('duplicate evidence is harmless; deleted bodies never join or appear', () => {
  const a = note('a'), b = note('b'), deleted = note('gone', { deleted: true })
  expect(groupMeetings([a, b, deleted], 'owner-a', [source('a'), source('a'), source('b'), source('gone')])).toEqual([{ id: expect.any(String), meetingGroup: true, notes: [a, b] }])
})
