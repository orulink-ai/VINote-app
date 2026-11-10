import Storage from '@react-native-async-storage/async-storage'
import { readFeishuLocalPreferences, readFeishuLocalPreferencesState, saveFeishuLocalPreferences } from '../src/lib/feishuLocalPreferences'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
beforeEach(() => { jest.clearAllMocks(); transitionIdentity('owner') })
test('uses device defaults rather than server preferences, then saves locally', async () => {
  jest.mocked(Storage.getItem).mockResolvedValueOnce(null)
  const prefs = await readFeishuLocalPreferences('owner')
  expect(prefs).toEqual({ notify_self: true, groups: [], destination_config: { kind: 'personal' }, permission_policy: 'private' })
  await saveFeishuLocalPreferences('owner', prefs)
  expect(Storage.setItem).toHaveBeenCalledWith('vinote:owner:feishu-local-preferences', JSON.stringify(prefs))
})
test('rejects another account', async () => {
  await expect(readFeishuLocalPreferences('other')).rejects.toThrow('账号已变化')
  expect(Storage.getItem).not.toHaveBeenCalled()
})
test('does not silently use invalid local preferences', async () => {
  jest.mocked(Storage.getItem).mockResolvedValueOnce('{"groups":"bad"}')
  await expect(readFeishuLocalPreferences('owner')).rejects.toThrow('本机飞书设置无法读取')
})
test('preference values and existence come from the same storage read', async () => {
  jest.mocked(Storage.getItem).mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({ notify_self: false, groups: [], destination_config: { kind: 'personal' }, permission_policy: 'private' }))
  const first = await readFeishuLocalPreferencesState('owner')
  expect(first.exists).toBe(false)
  expect(first.preferences.notify_self).toBe(true)
  expect(Storage.getItem).toHaveBeenCalledTimes(1)
  const second = await readFeishuLocalPreferencesState('owner')
  expect(second.exists).toBe(true)
  expect(second.preferences.notify_self).toBe(false)
})
