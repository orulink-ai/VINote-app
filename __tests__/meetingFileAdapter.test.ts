const mockHash = jest.fn(), mockSubmit = jest.fn(), mockQuery = jest.fn(), mockResult = jest.fn(), mockVerify = jest.fn()
jest.mock('react-native-fs', () => ({ __esModule: true, default: { DocumentDirectoryPath: '/docs', hash: (...args: unknown[]) => mockHash(...args) } }))
jest.mock('../src/lib/meetingFileUpload', () => ({ verifyMeetingFile: (...args: unknown[]) => mockVerify(...args), submitVerifiedMeetingFile: (...args: unknown[]) => mockSubmit(...args) }))
jest.mock('../src/lib/meetingFileApi', () => ({ readMeetingFileJob: (...args: unknown[]) => mockQuery(...args), readMeetingFileResult: (...args: unknown[]) => mockResult(...args) }))
import { runPreparedMeetingFile } from '../src/lib/meetingFileAdapter'
import { initialMeetingJob } from '../src/lib/meetingFileJobState'
const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const binding = { origin: 'https://api.example.com', providerModel: 'provider', originalSha256: 'a'.repeat(64), wavSha256: 'b'.repeat(64), wavBytes: 1000, duration: 10 }
const state = { checkpoint: { version: 1 as const, job: initialMeetingJob(id, 'model', 'owner'), binding }, wavUri: 'file:///cache/asr-1234.wav' }
const opts = () => ({ owner: 'owner', model: 'model', providerModel: 'provider', origin: binding.origin, sourceUri: 'file:///docs/recordings/accounts/owner/r1.m4a', guard: jest.fn(async () => {}), save: jest.fn(async () => {}), wait: jest.fn(async () => {}), progress: jest.fn() })
beforeEach(() => { jest.clearAllMocks(); mockHash.mockResolvedValue('a'.repeat(64)); mockVerify.mockResolvedValue(undefined); mockSubmit.mockResolvedValue({ id, status: 'processing' }); mockQuery.mockResolvedValue({ id, status: 'completed' }); mockResult.mockResolvedValue({ id, model: 'provider', text: '会议内容', segments: [] }) })
test('preflights saved audio, submits once, and polls its original job', async () => {
  const result = await runPreparedMeetingFile(state, opts())
  expect(result.result?.text).toBe('会议内容')
  expect(mockVerify).toHaveBeenCalledTimes(1)
  expect(mockSubmit).toHaveBeenCalledTimes(1)
  expect(mockQuery).toHaveBeenCalledTimes(1)
})
test('a changed recording or owner stops before any upload or query', async () => {
  mockHash.mockResolvedValue('c'.repeat(64))
  await expect(runPreparedMeetingFile(state, opts())).rejects.toThrow()
  await expect(runPreparedMeetingFile(state, { ...opts(), owner: 'other' })).rejects.toThrow()
  expect(mockSubmit).not.toHaveBeenCalled(); expect(mockQuery).not.toHaveBeenCalled()
})
test('legacy public jobs are queried at their recorded origin without a new upload', async () => {
  const legacy = { ...state, checkpoint: { ...state.checkpoint, job: { ...state.checkpoint.job, phase: 'submitted' as const }, binding: { ...binding, origin: 'https://api.orulink.ai' } } }
  const result = await runPreparedMeetingFile(legacy, { ...opts(), origin: 'https://api-hk.orulink.ai' })
  expect(result.result?.text).toBe('会议内容')
  expect(mockSubmit).not.toHaveBeenCalled()
  expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ id }), 'https://api.orulink.ai')
})
test('an unsubmitted legacy job is never uploaded after switching origins', async () => {
  const legacy = { ...state, checkpoint: { ...state.checkpoint, binding: { ...binding, origin: 'https://api.orulink.ai' } } }
  await expect(runPreparedMeetingFile(legacy, { ...opts(), origin: 'https://api-hk.orulink.ai' })).rejects.toThrow()
  expect(mockSubmit).not.toHaveBeenCalled()
})
