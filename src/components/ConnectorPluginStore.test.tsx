import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Pressable, TextInput } from 'react-native'
import Storage from '@react-native-async-storage/async-storage'
import { ConnectorPluginStore } from './ConnectorPluginStore'
import { connectorPluginKey } from '../lib/connectorPlugins'
import { transitionIdentity, identityEpoch } from '../lib/sessionIdentity'
import { ConnectionsScreen } from '../screens/ConnectionsScreen'
import { feishuApi } from '../lib/feishu'
jest.mock('../lib/storage', () => ({ readAccountId: jest.fn(async () => 'a') }))
jest.mock('../lib/feishu', () => ({ feishuApi: jest.fn(async () => ({ connected: true })) }))
let tree: ReactTestRenderer
const onFeishu = jest.fn(), onMcp = jest.fn()
async function mount() { await act(async () => { tree = create(<ConnectorPluginStore epoch={identityEpoch()} onFeishu={onFeishu} onMcp={onMcp} />) }) }
async function press(label: string) { expect(tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function').length).toBeGreaterThan(0); await act(async () => { tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]?.props.onPress() }) }
beforeEach(async () => {
  transitionIdentity('a'); jest.clearAllMocks()
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  ;(feishuApi as jest.Mock).mockResolvedValue({ connected: true })
})
afterEach(async () => { if (tree) await act(async () => tree.unmount()) })
it('persists install/disable, searches and opens existing connection management', async () => {
  await mount(); await press('安装')
  expect(JSON.parse((await Storage.getItem(connectorPluginKey('a')))!).feishu).toEqual({ installed: true, enabled: true })
  await press('停用'); await press('管理'); await press('管理 MCP 工具')
  expect(onFeishu).toHaveBeenCalledTimes(1); expect(onMcp).toHaveBeenCalledTimes(1)
  await act(async () => tree.root.findByType(TextInput).props.onChangeText('absent'))
  expect(JSON.stringify(tree.toJSON())).toContain('没有匹配的插件')
  await press('返回探索')
  await act(async () => tree.unmount()); await mount()
  expect(JSON.stringify(tree.toJSON())).toContain('已停用')
})
it('keeps failed save uninstalled and supports retry', async () => {
  await mount(); (Storage.setItem as jest.Mock).mockRejectedValueOnce(new Error('full'))
  await press('安装')
  expect(JSON.stringify(tree.toJSON())).toContain('原状态保留')
  expect(await Storage.getItem(connectorPluginKey('a'))).toBeNull()
  await press('重试')
  expect(JSON.stringify(tree.toJSON())).toContain('已启用')
})
it('ignores late authorization after identity changes', async () => {
  let resolve!: (value: { connected: boolean }) => void
  ;(feishuApi as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await mount()
  await act(async () => { transitionIdentity('b'); resolve({ connected: true }) })
  expect(JSON.stringify(tree.toJSON())).not.toContain('已有飞书授权，可直接管理')
})
it('does not expose diagram generation even through the compatible callback', async () => {
  const onContentPlugin = jest.fn()
  await act(async () => { tree = create(<ConnectionsScreen onFeishu={onFeishu} onMcp={onMcp} onContentPlugin={onContentPlugin} />) })
  expect(JSON.stringify(tree.toJSON())).not.toContain('流程图整理')
  expect(onContentPlugin).not.toHaveBeenCalled()
})
