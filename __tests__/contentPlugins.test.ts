import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from '../src/lib/storage'
import { integrationJson } from '../src/lib/integration'
import { pluginRun, readPluginIntent, submitPlugin, type PluginIntent } from '../src/lib/contentPlugins'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn(), operationId: () => 'stable-operation' }))
const draft: PluginIntent = { plugin_id: 'translation', note_key: 'note-a', version_id: 'version-1', base_revision: 3, operation_id: 'same-operation', language: 'en', glossary: '' }
beforeEach(async () => { jest.clearAllMocks(); (readAccountId as jest.Mock).mockResolvedValue('owner-a'); await Storage.removeItem('vinote:owner-a:plugin-intent') })
it('retains the exact intent when submission loses its receipt; recovery only reads that run', async () => {
  ;(integrationJson as jest.Mock).mockRejectedValueOnce(new Error('transport interrupted'))
  await expect(submitPlugin('owner-a', draft)).rejects.toThrow('transport interrupted')
  expect(await readPluginIntent('owner-a')).toEqual(draft)
  ;(integrationJson as jest.Mock).mockResolvedValueOnce({ id: draft.operation_id, status: 'ready' })
  await pluginRun('owner-a', draft.operation_id)
  expect((integrationJson as jest.Mock).mock.calls[1]).toEqual(['/api/plugins/runs/same-operation', {}, 'owner-a'])
  expect((integrationJson as jest.Mock).mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1)
})
it('does not send a request when durable intent saving fails', async () => {
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('storage full'))
  await expect(submitPlugin('owner-a', draft)).rejects.toThrow('storage full')
  expect(integrationJson).not.toHaveBeenCalled()
})
it('cannot resume another owner intent', async () => {
  ;(readAccountId as jest.Mock).mockResolvedValue('owner-b')
  await expect(readPluginIntent('owner-a')).rejects.toThrow('账号已切换')
  await expect(submitPlugin('owner-a', draft)).rejects.toThrow('账号已切换')
  expect(integrationJson).not.toHaveBeenCalled()
})
