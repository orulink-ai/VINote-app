import { devReadTiming, devReadDuration, readTimingEnabled } from '../src/lib/storage'

const flags = globalThis as typeof globalThis & { VINOTE_READ_TIMING?: boolean }
afterEach(() => { delete flags.VINOTE_READ_TIMING; jest.restoreAllMocks() })

test('temporary timing is silent by default and after explicitly disabling it', () => {
  delete flags.VINOTE_READ_TIMING
  const log = jest.spyOn(console, 'info').mockImplementation(() => {})
  expect(readTimingEnabled()).toBe(false)
  devReadTiming('note.total')(); devReadDuration('markdown.render', 12)
  flags.VINOTE_READ_TIMING = false
  devReadTiming('session.keychain')('failed')
  expect(log).not.toHaveBeenCalled()
})

test('opt-in logs only the anonymous whitelist and a span ends once', () => {
  flags.VINOTE_READ_TIMING = true
  const log = jest.spyOn(console, 'info').mockImplementation(() => {})
  const end = devReadTiming('note.total')
  end('ok'); end('failed'); devReadDuration('markdown.render', 12)
  expect(log).toHaveBeenCalledTimes(2)
  for (const [line] of log.mock.calls) expect(line).toMatch(/^\[VINoteReadTiming\] seq=\d+ stage=[a-z_.]+ ms=\d+\.\d count=\d+ outcome=ok$/)
})
