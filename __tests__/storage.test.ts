import * as Keychain from 'react-native-keychain'
import { clearToken, readSession, saveSession, sessionRevision } from '../src/lib/storage'
jest.mock('react-native-keychain', () => ({ setGenericPassword: jest.fn(), resetGenericPassword: jest.fn(), getGenericPassword: jest.fn() }))
beforeEach(() => jest.clearAllMocks())

test('logout is applied after an in-flight credential write and invalidates refresh immediately', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  jest.mocked(Keychain.setGenericPassword).mockImplementationOnce(async () => { await pending; return false })
  const saving = saveSession({ access_token: 'a', refresh_token: 'r', user: { id: 'u', email: 'u@example.com' } })
  await Promise.resolve()
  const revision = sessionRevision()
  const clearing = clearToken()
  expect(sessionRevision()).toBe(revision + 1)
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled()
  finish()
  await Promise.all([saving, clearing])
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(1)
})

test('a failed mutation does not block later logout or reads', async () => {
  jest.mocked(Keychain.setGenericPassword).mockRejectedValueOnce(new Error('storage failure'))
  await expect(saveSession({ access_token: 'a', refresh_token: 'r', user: { id: 'u', email: 'u@example.com' } })).rejects.toThrow('storage failure')
  await clearToken()
  jest.mocked(Keychain.getGenericPassword).mockResolvedValueOnce(false)
  expect(await readSession()).toBeNull()
})
