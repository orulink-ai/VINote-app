import { submitMeetingFile, readMeetingFileJob, readMeetingFileResult } from '../src/lib/meetingFileApi'
import { apiJson, meetingUploadJson, readLegacyMeetingJson } from '../src/lib/api'
import { initialMeetingJob } from '../src/lib/meetingFileJobState'
import { ApiError } from '../src/lib/errors'
jest.mock('../src/lib/api', () => ({ apiJson: jest.fn(), meetingUploadJson: jest.fn(), readLegacyMeetingJson: jest.fn() }))
const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const job = { ...initialMeetingJob(id, 'meeting-model', 'owner'), phase: 'submitted' as const }
beforeEach(() => { jest.clearAllMocks(); (apiJson as jest.Mock).mockResolvedValue({ id, status: 'queued' }); (meetingUploadJson as jest.Mock).mockResolvedValue({ id, status: 'queued' }) })
test('uploads a local WAV once with the original job id and model', async () => {
  await submitMeetingFile(job, 'file:///data/user/0/app/cache/audio.wav')
  expect(meetingUploadJson).toHaveBeenCalledTimes(1)
  expect(meetingUploadJson).toHaveBeenCalledWith('/v1/asr/transcription-jobs', expect.objectContaining({ method: 'POST', headers: { 'Idempotency-Key': id } }), 'owner', 7200000, undefined)
})
test('submits a verified local m4a with its actual MIME type', async () => {
  const append = jest.fn(), original = (globalThis as any).FormData;
  (globalThis as any).FormData = jest.fn(() => ({ append })) as any
  try {
    await submitMeetingFile(job, 'file:///data/recordings/accounts/owner/source.m4a')
    expect(append).toHaveBeenCalledWith('file', { uri: 'file:///data/recordings/accounts/owner/source.m4a', name: 'meeting.m4a', type: 'audio/mp4' })
  } finally { (globalThis as any).FormData = original }
})
test('refuses nonlocal and unsupported inputs before network dispatch', async () => {
  await expect(submitMeetingFile(job, 'https://example.com/audio.wav')).rejects.toThrow()
  await expect(submitMeetingFile(job, 'file:///data/audio.mp4')).rejects.toThrow()
  expect(meetingUploadJson).not.toHaveBeenCalled()
})
test('recovery and result endpoints retain the original owner and job id', async () => {
  await readMeetingFileJob(job)
  expect(apiJson).toHaveBeenLastCalledWith(`/v1/asr/transcription-jobs/${id}`, {}, 'owner')
  await readMeetingFileResult({ ...job, phase: 'result' })
  expect(apiJson).toHaveBeenLastCalledWith(`/v1/asr/transcription-jobs/${id}/result`, {}, 'owner')
})
test('legacy requests only read the original trusted public endpoint', async () => {
  jest.mocked(readLegacyMeetingJson).mockResolvedValue({ id, status: 'processing' })
  await readMeetingFileJob(job, 'https://api.orulink.ai')
  expect(readLegacyMeetingJson).toHaveBeenCalledWith(`/v1/asr/transcription-jobs/${id}`, 'owner')
  await expect(readMeetingFileJob(job, 'https://untrusted.example')).rejects.toThrow('服务地址不受信任')
  expect(apiJson).not.toHaveBeenCalled()
})
test('a missing original job explains that the source remains and does not upload again', async () => {
  jest.mocked(apiJson).mockRejectedValueOnce(new ApiError('The meeting transcription job was not found.', 404, { code: 'transcription_job_not_found' }))
  await expect(readMeetingFileJob(job)).rejects.toThrow('服务端未找到原转写任务')
  expect(apiJson).toHaveBeenCalledTimes(1)
})
test('explains a confirmed upload size rejection without hiding its status', async () => {
  jest.mocked(meetingUploadJson).mockRejectedValueOnce(new ApiError('Payload Too Large', 413))
  await expect(submitMeetingFile(job, 'file:///data/user/0/app/cache/audio.wav')).rejects.toMatchObject({ status: 413, message: expect.stringContaining('上传大小限制') })
})
