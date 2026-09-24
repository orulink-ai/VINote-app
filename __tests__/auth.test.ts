import { signIn, signOut, resetPassword } from '../src/lib/auth'
import { authRequest } from '../src/lib/supabase'
import { clearToken, saveSession } from '../src/lib/storage'
jest.mock('../src/lib/supabase', () => ({ authRequest: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ clearToken: jest.fn(), saveSession: jest.fn() }))
beforeEach(() => jest.clearAllMocks())
test('sign in persists Supabase session and logout only removes this device credentials', async () => {
  const session = { access_token: 'access', refresh_token: 'refresh', user: { id: 'alice', email: 'alice@example.com' } }
  jest.mocked(authRequest).mockResolvedValueOnce(session)
  await signIn('alice@example.com', 'password')
  expect(saveSession).toHaveBeenCalledWith(session)
  await signOut()
  expect(clearToken).toHaveBeenCalledTimes(1)
  expect(authRequest).toHaveBeenCalledTimes(1)
})
test('password recovery uses temporary recovery token without changing current session', async () => {
  jest.mocked(authRequest).mockResolvedValueOnce({ access_token: 'recovery' }).mockResolvedValueOnce({})
  await resetPassword('alice@example.com', '123456', 'newpassword')
  expect(authRequest).toHaveBeenLastCalledWith('/user', { password: 'newpassword' }, 'recovery', 'PUT')
  expect(saveSession).not.toHaveBeenCalled()
})
test('credential removal failures remain visible', async () => {
  jest.mocked(clearToken).mockRejectedValueOnce(new Error('keychain unavailable'))
  await expect(signOut()).rejects.toThrow('keychain unavailable')
})
