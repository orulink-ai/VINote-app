import { Platform } from 'react-native'

const mockStat = jest.fn(), mockHash = jest.fn(), mockSubmit = jest.fn()
jest.mock('react-native-fs', () => ({ __esModule: true, default: { CachesDirectoryPath: '/cache', TemporaryDirectoryPath: '/ios-tmp/', DocumentDirectoryPath: '/data', stat: (...args: unknown[]) => mockStat(...args), hash: (...args: unknown[]) => mockHash(...args) } }))
jest.mock('../src/lib/meetingFileApi', () => ({ submitMeetingFile: (...args: unknown[]) => mockSubmit(...args) }))
import { submitVerifiedMeetingFile } from '../src/lib/meetingFileUpload'
import { initialMeetingJob } from '../src/lib/meetingFileJobState'

const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const job = { ...initialMeetingJob(id, 'model', 'owner'), phase: 'submitted' as const }
const binding = { origin: 'https://api.example.com', providerModel: 'model', originalSha256: 'a'.repeat(64), wavSha256: 'b'.repeat(64), wavBytes: 1000, duration: 10 }
beforeEach(() => { jest.clearAllMocks(); jest.replaceProperty(Platform, 'OS', 'android'); mockStat.mockResolvedValue({ size: 1000 }); mockHash.mockResolvedValue('b'.repeat(64)); mockSubmit.mockResolvedValue({ id, status: 'processing' }) })
test('uploads only the owned cache whose size and hash match the saved checkpoint', async () => {
  const guard = jest.fn(async () => {})
  await submitVerifiedMeetingFile(job, binding, 'file:///cache/asr-1234.wav', guard)
  expect(mockSubmit).toHaveBeenCalledWith(job, 'file:///cache/asr-1234.wav', undefined)
})
test('rejects changed bytes and unrelated cache paths without dispatch', async () => {
  mockHash.mockResolvedValue('c'.repeat(64))
  await expect(submitVerifiedMeetingFile(job, binding, 'file:///cache/asr-1234.wav', async () => {})).rejects.toThrow()
  await expect(submitVerifiedMeetingFile(job, binding, 'file:///cache/other.wav', async () => {})).rejects.toThrow()
  expect(mockSubmit).not.toHaveBeenCalled()
})

test('compressed sources must belong to the same account and match the checkpoint', async () => {
  const compressed = { ...binding, audioFormat: 'm4a' as const, wavSha256: 'a'.repeat(64) }
  mockHash.mockResolvedValue('a'.repeat(64))
  const uri = 'file:///data/recordings/accounts/owner/source.m4a'
  await submitVerifiedMeetingFile(job, compressed, uri, async () => {})
  expect(mockSubmit).toHaveBeenCalledWith(job, uri, undefined)
  await expect(submitVerifiedMeetingFile(job, compressed, 'file:///data/recordings/accounts/other/source.m4a', async () => {})).rejects.toThrow()
})

afterEach(() => jest.restoreAllMocks())

test('uploads verified WAV from the iOS native temporary directory', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios')
  const wavUri = 'file:///ios-tmp/asr-1234.wav'
  await submitVerifiedMeetingFile(job, binding, wavUri, async () => {})
  expect(mockSubmit).toHaveBeenCalledWith(job, wavUri, undefined)
})

test.each([
  ['ios', 'file:///cache/asr-1234.wav'],
  ['android', 'file:///ios-tmp/asr-1234.wav'],
] as const)('rejects a WAV in the other platform directory on %s', async (platform, uri) => {
  jest.replaceProperty(Platform, 'OS', platform)
  await expect(submitVerifiedMeetingFile(job, binding, uri, async () => {})).rejects.toThrow('缓存路径无效')
  expect(mockSubmit).not.toHaveBeenCalled()
})
