import { runMeetingFile } from '../src/lib/meetingFileRun'
import { initialMeetingJob } from '../src/lib/meetingFileJobState'
const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const binding = { origin: 'https://api.example.com', providerModel: 'model', originalSha256: 'a'.repeat(64), wavSha256: 'b'.repeat(64), wavBytes: 1000, duration: 10 }
const initial = { version: 1 as const, job: initialMeetingJob(id, 'model', 'owner'), binding }
const api = () => ({ guard: jest.fn(async () => {}), save: jest.fn(async () => {}), submit: jest.fn(async () => ({ id, status: 'processing' })), query: jest.fn(async () => ({ id, status: 'completed' })), result: jest.fn(async () => ({ id, model: 'model', text: '会议内容', segments: [] })), wait: jest.fn(async () => {}), progress: jest.fn() })
test('submits once, polls the same job and saves confirmed result', async () => {
  const ops = api()
  const result = await runMeetingFile(initial, binding, ops)
  expect(result.result?.text).toBe('会议内容')
  expect(ops.submit).toHaveBeenCalledTimes(1)
  expect(ops.query).toHaveBeenCalledTimes(1)
  expect(ops.progress).toHaveBeenCalledWith('submitted')
})
test('does not retry a task whose result is unknown', async () => {
  const ops = api()
  const result = await runMeetingFile({ ...initial, job: { ...initial.job, phase: 'unknown' } }, binding, ops)
  expect(result.job.phase).toBe('unknown')
  expect(ops.submit).not.toHaveBeenCalled()
  expect(ops.query).not.toHaveBeenCalled()
})
test('rejects a corrupt saved phase instead of polling forever', async () => {
  const ops = api()
  let calls = 0
  ops.guard.mockImplementation(async () => { if (++calls > 3) throw new Error('重复循环') })
  const bad = { ...initial, job: { ...initial.job, phase: 'corrupt' as never } }
  await expect(runMeetingFile(bad, binding, ops)).rejects.toThrow('会议转写任务状态无效')
  expect(ops.submit).not.toHaveBeenCalled()
})
