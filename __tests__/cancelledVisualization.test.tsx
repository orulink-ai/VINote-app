import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import Storage from '@react-native-async-storage/async-storage'
import { integrationJson } from '../src/lib/integration'
import { ContentPluginsScreen } from '../src/screens/ContentPluginsScreen'
import { submitPlugin, retryPlugin, pluginRun, type PluginIntent } from '../src/lib/contentPlugins'
import { PrimaryButton } from '../src/components/PrimaryButton'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn(), operationId: () => 'operation' }))
jest.mock('../src/lib/workspace', () => ({ readWorkspace: jest.fn(async () => ({ cache: {}, mappings: {} })), fetchWorkspaceNote: jest.fn() }))
const old = { id: 'old-run', plugin_id: 'diagram', status: 'failed', retry_safe: true, output: '', error: 'failed', created_at: '2026-10-14', note_key: 'note', base_revision: 1, model: 'old' }
beforeEach(async () => { jest.clearAllMocks(); await Storage.removeItem('vinote:owner:plugin-intent'); jest.mocked(integrationJson).mockImplementation(async path => path === '/api/plugins/runs' ? [old] : path === '/api/plugins' ? [] : old as never) })
test('new diagram submit and stale history retry fail before persistence or network', async () => {
  const intent: PluginIntent = { plugin_id: 'diagram', note_key: 'note', version_id: 'v', base_revision: 1, operation_id: 'op', language: '', glossary: '' }
  const write = jest.spyOn(Storage, 'setItem')
  await expect(submitPlugin('owner', intent)).rejects.toThrow('已停止')
  await expect(retryPlugin('owner', old.id)).rejects.toThrow('不再重新生成')
  expect(write).not.toHaveBeenCalled(); expect(integrationJson).not.toHaveBeenCalled()
  await pluginRun('owner', old.id)
  expect(integrationJson).toHaveBeenCalledWith('/api/plugins/runs/old-run', {}, 'owner')
  write.mockRestore()
})
test.each(['failed', 'interrupted', 'ready', 'saved'])('history %s remains reachable without generation controls', async status => {
  jest.mocked(integrationJson).mockImplementation(async path => path === '/api/plugins/runs' ? [{ ...old, status }] : path === '/api/plugins' ? [] : { ...old, status, output: status === 'ready' || status === 'saved' ? '# 历史结果' : '' } as never)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<ContentPluginsScreen onBack={jest.fn()} onOpen={jest.fn()} />) })
  await act(async () => view.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel?.startsWith('流程图整理，'))[0].props.onPress())
  const titles = view.root.findAllByType(PrimaryButton).map(node => node.props.title)
  expect(titles).toContain('核验原处理结果')
  expect(titles).not.toContain('重试本次生成'); expect(titles).not.toContain('生成预览'); expect(titles).not.toContain('选择内容开始另一项处理')
  if (status === 'ready') expect(titles).toContain('保存为新版本')
  expect(jest.mocked(integrationJson).mock.calls.every(args => !args[1]?.method || args[1]?.method === 'GET')).toBe(true)
  await act(async () => view.unmount())
})
