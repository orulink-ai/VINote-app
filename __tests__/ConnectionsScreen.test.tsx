import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { ConnectionsScreen } from '../src/screens/ConnectionsScreen'
import Storage from '@react-native-async-storage/async-storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'plugin-fixture-owner') }))
jest.mock('../src/lib/feishu', () => ({ feishuApi: jest.fn(async () => ({ connected: true })) }))

let view: Renderer.ReactTestRenderer
beforeEach(async () => {
  transitionIdentity('plugin-fixture-owner')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
afterEach(async () => { if (view) await act(async () => view.unmount()) })
const press = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress()

test('offers one MCP management entry and describes translation without a duplicate execution action', async () => {
  const onMcp = jest.fn(), onContentPlugin = jest.fn()
  await act(async () => { view = Renderer.create(<ConnectionsScreen onFeishu={jest.fn()} onMcp={onMcp} onContentPlugin={onContentPlugin} />) })
  const buttons = view.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'button')
  expect(buttons.filter(node => node.props.accessibilityLabel === '管理 MCP 工具')).toHaveLength(1)
  expect(buttons.some(node => node.props.accessibilityLabel === '全文翻译 · MCP')).toBe(false)
  expect(JSON.stringify(view.toJSON())).toContain('全文翻译从内容详情进入')
  expect(JSON.stringify(view.toJSON())).toContain('工具连接管理')
  await act(async () => press('管理 MCP 工具'))
  expect(onMcp).toHaveBeenCalledTimes(1)
  expect(onContentPlugin).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).not.toContain('流程图整理')
  expect(onContentPlugin).not.toHaveBeenCalled()
})

test('keeps Feishu and contextual return available without a content-plugin callback', async () => {
  const onBack = jest.fn(), onFeishu = jest.fn()
  await act(async () => { view = Renderer.create(<ConnectionsScreen onBack={onBack} onFeishu={onFeishu} onMcp={jest.fn()} />) })
  const buttons = view.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'button')
  await act(async () => press('管理授权'))
  await act(async () => press('返回设置'))
  expect(onFeishu).toHaveBeenCalledTimes(1)
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(buttons.some(node => node.props.accessibilityLabel === '流程图整理')).toBe(false)
})
