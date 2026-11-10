import Storage from '@react-native-async-storage/async-storage'
import { readFeishuAutoConsent, saveFeishuAutoConsent } from '../src/lib/feishuAutoConsent'
import { transitionIdentity } from '../src/lib/sessionIdentity'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
beforeEach(async () => { transitionIdentity('owner'); for (const key of await Storage.getAllKeys()) await Storage.removeItem(key) })

test('automatic publishing defaults off and requires a verified connection binding', async () => {
  expect(await readFeishuAutoConsent('owner')).toBeNull()
  await expect(saveFeishuAutoConsent('owner', { connectionBinding: '', settingsFingerprint: 'settings', consentId: 'id' })).rejects.toThrow()
  expect(await readFeishuAutoConsent('owner')).toBeNull()
})

test('consent is stored locally per owner and can be revoked', async () => {
  const consent = { connectionBinding: 'binding', settingsFingerprint: 'settings', consentId: 'id' }
  await saveFeishuAutoConsent('owner', consent)
  expect(await readFeishuAutoConsent('owner')).toEqual(consent)
  await saveFeishuAutoConsent('owner', null)
  expect(await readFeishuAutoConsent('owner')).toBeNull()
})
