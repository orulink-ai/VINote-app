import { initialMeetingJob, acceptMeetingJob, meetingJobAction } from '../src/lib/meetingFileJobState'

const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
test('a recorded submission is queried using its original id, never blindly uploaded again', () => {
  const initial = initialMeetingJob(id, 'model', 'owner')
  expect(meetingJobAction(initial)).toBe('submit')
  const sending = { ...initial, phase: 'submitted' as const }
  expect(meetingJobAction(sending)).toBe('query')
  expect(acceptMeetingJob(sending, { id, status: 'processing' }).phase).toBe('submitted')
  expect(acceptMeetingJob(sending, { id, status: 'completed' }).phase).toBe('result')
})
test('rejects a different job and preserves unknown or failed status without retry', () => {
  const sent = { ...initialMeetingJob(id, 'model', 'owner'), phase: 'submitted' as const }
  expect(() => acceptMeetingJob(sent, { id: 'other', status: 'completed' })).toThrow()
  expect(meetingJobAction(acceptMeetingJob(sent, { id, status: 'outcome_unknown' }))).toBe('stop')
  expect(meetingJobAction(acceptMeetingJob(sent, { id, status: 'failed' }))).toBe('stop')
})
test('refuses invalid stable job identity', () => {
  expect(() => initialMeetingJob('bad', 'model', 'owner')).toThrow()
  expect(() => initialMeetingJob(id, '', 'owner')).toThrow()
})
