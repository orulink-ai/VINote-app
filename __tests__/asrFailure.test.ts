import { ASRServiceFailure } from '../src/lib/asrFailure'
import { TransportError } from '../src/lib/errors'
test.each(['empty_result_unverified', 'asr_empty_result', 'unknown_result', 'asr_provider_error', 'asr_auth_rejected'])('preserves allowlisted %s without treating empty as noSpeech or making it transient', code => {
  const error = new ASRServiceFailure(code, 'asr', true, true)
  expect(error.code).toBe(code)
  expect(error.diagnostic).toMatchObject({ stage: 2, audioAttempted: 1, sentComplete: 1 })
  expect(error).not.toBeInstanceOf(TransportError)
  expect(Object.isFrozen(error.diagnostic)).toBe(true)
  expect(error.message).not.toContain('静音')
})
test.each(['SYNTHETIC_SECRET_AND_BODY', '__proto__', 'constructor', {}, null])('rejects arbitrary code and stage without retaining raw values', code => {
  const error = new ASRServiceFailure(code, 'SYNTHETIC_SECRET_AND_BODY', false, false)
  expect(error.code).toBe('unknown_error')
  expect(error.diagnostic).toEqual({ category: 0, stage: 0, audioAttempted: 0, sentComplete: 0 })
  expect(JSON.stringify(error)).not.toContain('SYNTHETIC_SECRET_AND_BODY')
})
