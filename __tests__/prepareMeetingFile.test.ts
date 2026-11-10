import FS from 'react-native-fs'
import { NativeModules } from 'react-native'
import { prepareMeetingFile } from '../src/lib/prepareMeetingFile'
jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/data', CachesDirectoryPath: '/cache', stat: jest.fn(), hash: jest.fn(), exists: jest.fn(), unlink: jest.fn() }))
const input = { uri: 'file:///data/recordings/accounts/owner/source.m4a', origin: 'https://api.example.com', owner: 'owner', model: 'catalog-id', providerModel: 'bigmodel', id: '4d030132-7222-401c-80c5-c352b0c1e5cf', policy: { maxAudioBytes: 1000, maxAudioSeconds: 100 }, guard: jest.fn(async () => {}) }
beforeEach(() => {
  jest.clearAllMocks()
  ;(FS.stat as jest.Mock).mockImplementation(async (path: string) => ({ size: path.endsWith('.wav') ? 500 : 300 }))
  ;(FS.hash as jest.Mock).mockImplementation(async (path: string) => (path.endsWith('.wav') ? 'b' : 'a').repeat(64))
  ;(FS.exists as jest.Mock).mockResolvedValue(true)
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/asr-4d030132-7222-401c-80c5-c352b0c1e5cf.wav'), wavInfo: jest.fn(async () => 10) }
})
test('binds source and normalized WAV to one original account, service, model and job', async () => {
  const prepared = await prepareMeetingFile(input)
  expect(prepared.checkpoint.job).toMatchObject({ id: input.id, owner: 'owner', model: 'catalog-id', phase: 'created' })
  expect(prepared.checkpoint.binding).toMatchObject({ originalSha256: 'a'.repeat(64), wavSha256: 'b'.repeat(64), providerModel: 'bigmodel', wavBytes: 500, duration: 10 })
})
test('rejects service limits without dispatch and removes only the temporary WAV', async () => {
  await expect(prepareMeetingFile({ ...input, policy: { maxAudioBytes: 100, maxAudioSeconds: 100 } })).rejects.toThrow()
  expect(FS.unlink).toHaveBeenCalledWith('/cache/asr-4d030132-7222-401c-80c5-c352b0c1e5cf.wav')
  expect(FS.unlink).not.toHaveBeenCalledWith('/data/recordings/accounts/owner/source.m4a')
})
test('uses the original compressed recording only when the selected server advertises m4a', async () => {
  NativeModules.MeetingAudio.m4aInfo = jest.fn(async () => 10)
  const prepared = await prepareMeetingFile({ ...input, policy: { ...input.policy, supportsM4a: true } })
  expect(prepared.wavUri).toBe(input.uri)
  expect(prepared.checkpoint.binding).toMatchObject({ audioFormat: 'm4a', wavBytes: 300, wavSha256: 'a'.repeat(64), duration: 10 })
  expect(NativeModules.MeetingAudio.toWav).not.toHaveBeenCalled()
})
test('note files continue using an independent cache until deletion is guarded', async () => {
  NativeModules.MeetingAudio.m4aInfo = jest.fn(async () => 10)
  const prepared = await prepareMeetingFile({ ...input, uri: 'file:///data/files/accounts/owner/source.m4a', policy: { ...input.policy, supportsM4a: true } })
  expect(prepared.wavUri).toMatch(/\.wav$/)
  expect(NativeModules.MeetingAudio.m4aInfo).not.toHaveBeenCalled()
})
test('extracts audio instead of uploading a container with other tracks', async () => {
  NativeModules.MeetingAudio.m4aInfo = jest.fn(async () => { throw new Error('contains video') })
  const prepared = await prepareMeetingFile({ ...input, policy: { ...input.policy, supportsM4a: true } })
  expect(prepared.wavUri).toMatch(/\.wav$/)
  expect(prepared.checkpoint.binding.audioFormat).toBeUndefined()
  expect(NativeModules.MeetingAudio.toWav).toHaveBeenCalledWith(input.uri)
})
