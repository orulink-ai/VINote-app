import { meetingFilePolicy } from '../src/lib/meetingFilePolicy'

describe('whole-file meeting model capability', () => {
  const valid = { runtimeStatus: 'available', capabilities: { recordedAudio: { protocol: 1, supported: true, strategy: 'single_request', policySource: 'provider_model' }, useCases: ['meeting'], protocols: ['asr-recording'], audioFormats: ['wav'], audioDelivery: 'public', speakerDiarization: true, utteranceTimestamps: true, maxAudioSeconds: 3600, maxAudioBytes: 100000000 } }
  it('accepts the explicit server capability and limits', () => {
    expect(meetingFilePolicy(valid)).toEqual({ maxAudioSeconds: 3600, maxAudioBytes: 100000000 })
  })
  it('uses compressed m4a only when the selected service explicitly advertises it', () => {
    const withM4a = { ...valid, capabilities: { ...valid.capabilities, audioFormats: ['wav', 'm4a'] } }
    expect(meetingFilePolicy(withM4a)).toEqual({ maxAudioSeconds: 3600, maxAudioBytes: 100000000, supportsM4a: true })
    expect(meetingFilePolicy(valid)?.supportsM4a).toBeUndefined()
  })
  it('does not infer meeting support from a model name or incomplete capability', () => {
    expect(meetingFilePolicy({ id: 'bigmodel' })).toBeUndefined()
    expect(meetingFilePolicy({ ...valid, capabilities: { ...valid.capabilities, speakerDiarization: false } })).toBeUndefined()
    expect(meetingFilePolicy({ ...valid, capabilities: { ...valid.capabilities, audioDelivery: 'private' } })).toBeUndefined()
    expect(meetingFilePolicy({ ...valid, capabilities: { ...valid.capabilities, maxAudioBytes: 0 } })).toBeUndefined()
  })
  it('does not expose disabled or quota-exhausted models as ready', () => {
    expect(meetingFilePolicy({ ...valid, availability: { status: 'quota_exhausted' } })).toBeUndefined()
    expect(meetingFilePolicy({ ...valid, availability: { status: 'disabled' } })).toBeUndefined()
  })
})
