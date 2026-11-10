import { parseMeetingFileResult } from '../src/lib/meetingFileResult'
const job = { id: '4d030132-7222-401c-80c5-c352b0c1e5cf', model: 'model-a', owner: 'owner', phase: 'result' as const }
test('keeps actual utterance timestamps and speaker labels from the service', () => {
  const data = { id: job.id, model: job.model, text: '你好', segments: [{ start: 1.5, end: 2.5, text: '你好', speakerId: '1' }] }
  expect(parseMeetingFileResult(job, data, 10, job.model)).toEqual({ text: '你好', segments: [{ start: 1.5, end: 2.5, text: '你好', speakerId: '1' }] })
})
test('rejects mismatched identity, empty transcription and invalid timestamps', () => {
  const data = { id: job.id, model: job.model, text: '内容', segments: [{ start: 1, end: 2, text: '内容' }] }
  for (const changed of [{ ...data, id: 'other' }, { ...data, model: 'other' }, { ...data, text: ' ' }, { ...data, segments: [{ start: 1, end: 100, text: '内容' }] }]) {
    expect(() => parseMeetingFileResult(job, changed, 10, job.model)).toThrow()
  }
})
test('catalog ID and provider model are different identifiers', () => {
  const catalogJob = { ...job, model: 'asr:provider:bigmodel' }
  const data = { id: job.id, model: 'bigmodel', text: '内容', segments: [] }
  expect(parseMeetingFileResult(catalogJob, data, 10, 'bigmodel').text).toBe('内容')
})
