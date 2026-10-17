import Storage from '@react-native-async-storage/async-storage'
import { assertFeishuPublishReady, FeishuPreflightError, publishToFeishu } from '../src/lib/feishu'
import { connectorPluginKey } from '../src/lib/connectorPlugins'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { integrationJson } from '../src/lib/integration'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'A') }))
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn(), IntegrationError: class extends Error {} }))
beforeEach(async () => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('A'); transitionIdentity('A')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
const install = (owner = 'A', enabled = true) => Storage.setItem(connectorPluginKey(owner), JSON.stringify({ version: 1, feishu: { installed: true, enabled } }))
test('static module imports initialize; uninstalled and disabled preflights are typed not-dispatched without HTTP', async () => {
  await expect(assertFeishuPublishReady('A')).rejects.toBeInstanceOf(FeishuPreflightError)
  await expect(publishToFeishu('note', 'title', 'body', false, 'A')).rejects.toMatchObject({ code: 'FEISHU_PLUGIN_UNAVAILABLE', dispatchState: 'not_dispatched' })
  await install('A', false)
  await expect(publishToFeishu('note', 'title', 'body', false, 'A')).rejects.toBeInstanceOf(FeishuPreflightError)
  expect(integrationJson).not.toHaveBeenCalled()
})
test('current account installation permits one POST with original source/options/operation unchanged', async () => {
  await install('B'); await expect(assertFeishuPublishReady('A')).rejects.toBeInstanceOf(FeishuPreflightError)
  await install('A'); await assertFeishuPublishReady('A')
  jest.mocked(integrationJson).mockResolvedValue({ id: 'job', operation_id: 'original' })
  await publishToFeishu('note', 'frozen title', 'frozen body', false, 'A', { operation_id: 'original', notify_self: false, groups: [] })
  expect(integrationJson).toHaveBeenCalledTimes(1)
  const [path, init, owner] = jest.mocked(integrationJson).mock.calls[0]
  expect(path).toBe('/api/feishu/deliveries'); expect(owner).toBe('A'); expect(init?.method).toBe('POST')
  expect(JSON.parse(init!.body as string)).toMatchObject({ note_key: 'note', title: 'frozen title', content: 'frozen body', operation_id: 'original', notify_self: false })
})
test('publish repeats the guard after an earlier successful preflight', async () => {
  await install(); await assertFeishuPublishReady('A'); await install('A', false)
  await expect(publishToFeishu('note', 'title', 'body', false, 'A')).rejects.toMatchObject({ dispatchState: 'not_dispatched' })
  expect(integrationJson).not.toHaveBeenCalled()
})
test('A-B-A during delayed plugin storage cannot use the earlier account grant', async () => {
  let finish!: (value: string) => void
  jest.spyOn(Storage, 'getItem').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = assertFeishuPublishReady('A')
  const rejected = expect(pending).rejects.toThrow('账号')
  await Promise.resolve(); await Promise.resolve()
  transitionIdentity('B'); transitionIdentity('A')
  finish(JSON.stringify({ version: 1, feishu: { installed: true, enabled: true } }))
  await rejected
  expect(integrationJson).not.toHaveBeenCalled()
})
