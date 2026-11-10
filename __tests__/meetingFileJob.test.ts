import { initialMeetingJob } from '../src/lib/meetingFileJobState'
import { dispatchMeetingFileJob, queryMeetingFileJob } from '../src/lib/meetingFileJob'
const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const job = () => initialMeetingJob(id, 'model', 'owner')
test('persists the exact attempt before upload and preserves it when the response is lost', async () => {
  const order: string[] = []
  const save = jest.fn(async () => { order.push('save') })
  const submit = jest.fn(async () => { order.push('submit'); throw new Error('connection lost') })
  await expect(dispatchMeetingFileJob(job(), { save, submit, guard: async () => {} })).rejects.toThrow()
  expect(order).toEqual(['save', 'submit'])
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ id, phase: 'submitted' }))
  expect(submit).toHaveBeenCalledTimes(1)
})
test('recovery only queries the exact stored attempt and saves completion', async () => {
  const stored = { ...job(), phase: 'submitted' as const }
  const save = jest.fn(async () => {})
  const query = jest.fn(async () => ({ id, status: 'completed' }))
  const result = await queryMeetingFileJob(stored, { save, query, guard: async () => {} })
  expect(query).toHaveBeenCalledWith(stored)
  expect(result.phase).toBe('result')
  expect(save).toHaveBeenCalledWith(result)
})
test('never submits an already dispatched job', async () => {
  const submit = jest.fn()
  await expect(dispatchMeetingFileJob({ ...job(), phase: 'submitted' }, { save: async () => {}, submit, guard: async () => {} })).rejects.toThrow()
  expect(submit).not.toHaveBeenCalled()
})
test('local preflight failure leaves the job undispatched', async () => {
  const save = jest.fn(), submit = jest.fn()
  await expect(dispatchMeetingFileJob(job(), { save, submit, guard: async () => {}, preflight: async () => { throw new Error('音频不存在') } })).rejects.toThrow('音频不存在')
  expect(save).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
})
