import { restartMissingMeetingJob } from '../src/features/recording/restartMissingMeetingJob'
import { ApiError } from '../src/lib/errors'
import { readMeetingFileJob } from '../src/lib/meetingFileApi'
import { listRecordings, saveRecording } from '../src/features/recording/recordingLibrary'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/meetingFileApi', () => ({ readMeetingFileJob: jest.fn() }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(), saveRecording: jest.fn(async value => value) }))
const prepared = { wavUri: 'file:///cache/a.wav', checkpoint: { version: 1, job: { id: '4d030132-7222-401c-80c5-c352b0c1e5cf', owner: 'owner', model: 'asr', phase: 'submitted' }, binding: { origin: 'https://api-hk.orulink.ai' } } }
const record = { id: 'record', uri: 'file:///record.m4a', createdAt: '', title: '原录音', duration: 1, meetingFilePrepared: prepared, generation: { status: 'paused', asrModel: 'asr', llmModel: 'llm', startedAt: '', version: 1 }, errorDetails: { status: 404, code: 'transcription_job_not_found' } } as any
beforeEach(() => { jest.clearAllMocks(); jest.mocked(listRecordings).mockResolvedValue([record]) })
test('preserves old job and source only after the original endpoint confirms a missing job', async () => {
  jest.mocked(readMeetingFileJob).mockRejectedValue(new ApiError('missing', 404, { code: 'transcription_job_not_found' }))
  const next = await restartMissingMeetingJob(record.id)
  expect(next.meetingFilePrepared).toBeUndefined()
  expect(next.previousMeetingFileAttempts).toEqual([prepared])
  expect(next.uri).toBe(record.uri)
  expect(next.generation?.version).toBe(1)
})
test('does not replace a job that still exists or an uncertain network failure', async () => {
  jest.mocked(readMeetingFileJob).mockResolvedValue({ id: prepared.checkpoint.job.id, status: 'processing' })
  await expect(restartMissingMeetingJob(record.id)).rejects.toThrow()
  expect(saveRecording).not.toHaveBeenCalled()
  jest.mocked(readMeetingFileJob).mockRejectedValue(new ApiError('unavailable', 503))
  await expect(restartMissingMeetingJob(record.id)).rejects.toThrow()
  expect(saveRecording).not.toHaveBeenCalled()
})
test('does not re-submit another account’s job', async () => {
  jest.mocked(listRecordings).mockResolvedValue([{ ...record, meetingFilePrepared: { ...prepared, checkpoint: { ...prepared.checkpoint, job: { ...prepared.checkpoint.job, owner: 'other' } } } }])
  await expect(restartMissingMeetingJob(record.id)).rejects.toThrow()
  expect(readMeetingFileJob).not.toHaveBeenCalled()
  expect(saveRecording).not.toHaveBeenCalled()
})
