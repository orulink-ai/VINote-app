import { advanceMeetingFile } from '../src/lib/meetingFileWorkflow'
import { initialMeetingJob } from '../src/lib/meetingFileJobState'
const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const binding = { origin: 'https://api.example.com', providerModel: 'model', originalSha256: 'a'.repeat(64), wavSha256: 'b'.repeat(64), wavBytes: 1000, duration: 10 }
const checkpoint = () => ({ version: 1 as const, job: initialMeetingJob(id, 'model', 'owner'), binding })
const ops = () => ({ guard: jest.fn(async () => {}), save: jest.fn(async () => {}), submit: jest.fn(async () => ({ id, status: 'processing' })), query: jest.fn(async () => ({ id, status: 'completed' })), result: jest.fn(async () => ({ id, model: 'model', text: '会议内容', segments: [] })) })
test('records identity before uploading and preserves the job for recovery', async () => {
  const api = ops()
  const next = await advanceMeetingFile(checkpoint(), binding, api)
  expect(api.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ job: expect.objectContaining({ id, phase: 'submitted' }) }))
  expect(api.submit).toHaveBeenCalledTimes(1)
  expect(next.job.phase).toBe('submitted')
})
test('never uploads again during recovery and retains a verified final result', async () => {
  const api = ops(), cp = { ...checkpoint(), job: { ...checkpoint().job, phase: 'submitted' as const } }
  const next = await advanceMeetingFile(cp, binding, api)
  expect(api.submit).not.toHaveBeenCalled()
  expect(api.query).toHaveBeenCalledTimes(1)
  expect(next.job.phase).toBe('result')
  expect(next.result?.text).toBe('会议内容')
})
test('source or service changes block before any upload or query', async () => {
  const api = ops()
  await expect(advanceMeetingFile(checkpoint(), { ...binding, originalSha256: 'c'.repeat(64) }, api)).rejects.toThrow()
  expect(api.submit).not.toHaveBeenCalled(); expect(api.query).not.toHaveBeenCalled()
})
test('rejects a damaged saved result rather than treating it as completed', async () => {
  const api = ops()
  const cp = { ...checkpoint(), job: { ...checkpoint().job, phase: 'result' as const }, result: { text: '', segments: [] } }
  await expect(advanceMeetingFile(cp, binding, api)).rejects.toThrow()
  expect(api.submit).not.toHaveBeenCalled()
})
