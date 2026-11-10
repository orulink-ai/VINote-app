import { planMeetingDeletion } from '../src/features/recording/meetingDeletePlan'
test('includes only notes explicitly associated with the recording', () => {
  const notes = [{ id: 'n1', task_id: 'r1' }, { id: 'n2', task_id: 'r1' }, { id: 'other', task_id: 'r2' }]
  expect(planMeetingDeletion({ id: 'r1', noteId: 'n2' }, notes)).toEqual(['n1', 'n2'])
})
test('does not delete or guess a stale pointer belonging to another recording', () => {
  expect(() => planMeetingDeletion({ id: 'r1', noteId: 'other' }, [{ id: 'other', task_id: 'r2' }])).toThrow()
})
test('ignores a missing old pointer while including exact current associations', () => {
  expect(planMeetingDeletion({ id: 'r1', noteId: 'missing' }, [{ id: 'n1', task_id: 'r1' }])).toEqual(['n1'])
})
