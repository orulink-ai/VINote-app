import { verificationTrace, verificationFailure } from '../src/lib/verificationDiagnostics'
import { ApiError } from '../src/lib/errors'

const flags = globalThis as typeof globalThis & { VINOTE_VERIFY_DIAGNOSTICS?: boolean }
afterEach(() => { delete flags.VINOTE_VERIFY_DIAGNOSTICS; jest.restoreAllMocks() })

test('diagnostics are off by default and switch-off suppresses an existing trace', () => {
  const output = jest.spyOn(console, 'info').mockImplementation(() => {})
  delete flags.VINOTE_VERIFY_DIAGNOSTICS
  expect(verificationTrace()).toBeUndefined()
  flags.VINOTE_VERIFY_DIAGNOSTICS = true
  const trace = verificationTrace()!
  flags.VINOTE_VERIFY_DIAGNOSTICS = false; trace('verify', 'ok')
  expect(output).not.toHaveBeenCalled()
})

test('only anonymous stage, elapsed time, category and valid HTTP status are emitted', () => {
  const output = jest.spyOn(console, 'info').mockImplementation(() => {})
  flags.VINOTE_VERIFY_DIAGNOSTICS = true
  const trace = verificationTrace()!
  trace('user_http', 'http', 401)
  trace('verify', verificationFailure(new ApiError('private-body/token/header/email', 503), false), 503)
  trace('verify', verificationFailure(new TypeError('private-URL?credential'), false))
  trace('verify', 'failed', 999)
  for (const [line] of output.mock.calls) expect(line).toMatch(/^\[VINoteVerify\] seq=\d+ stage=[a-z_]+ ms=\d+ outcome=[a-z_]+(?: status=[1-5]\d\d)?(?: code=[a-z_]+)?$/)
  expect(output.mock.calls[0][0]).toContain('status=401')
  expect(JSON.stringify(output.mock.calls)).not.toMatch(/private|token|header|email|credential|URL|999/)
})

test('only fixed public error codes pass through; raw strings and absent codes are sanitized', () => {
  const output = jest.spyOn(console, 'info').mockImplementation(() => {})
  flags.VINOTE_VERIFY_DIAGNOSTICS = true
  const trace = verificationTrace()!
  trace('user_http', 'http', 403, 'bad_jwt')
  trace('user_http', 'http', 403, 'private-body/email/token/URL?secret')
  trace('user_http', 'http', 403)
  trace('user_http', 'http', 403, { code: 'bad_jwt', private: 'secret' })
  expect(output.mock.calls[0][0]).toContain('code=bad_jwt')
  expect(output.mock.calls[1][0]).toContain('code=unrecognized')
  expect(output.mock.calls[2][0]).toContain('code=missing')
  expect(output.mock.calls[3][0]).toContain('code=unrecognized')
  expect(JSON.stringify(output.mock.calls)).not.toMatch(/private|token|secret|email|URL/)
})

test('deadline, HTTP rejection, transport and stale identity remain distinct without error text', () => {
  expect(verificationFailure(new Error('anything'), true)).toBe('deadline')
  expect(verificationFailure(new ApiError('anything', 401), false)).toBe('http')
  expect(verificationFailure(new TypeError('anything'), false)).toBe('transport')
  expect(verificationFailure(Object.assign(new Error('anything'), { code: 'SESSION_SCOPE_CHANGED' }), false)).toBe('scope_changed')
})
