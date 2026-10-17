import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { ConnectionsScreen } from '../src/screens/ConnectionsScreen'

let view: Renderer.ReactTestRenderer
afterEach(async () => { if (view) await act(async () => view.unmount()) })
const press = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress()

test('offers one MCP management entry and describes translation without a duplicate execution action', async () => {
  const onMcp = jest.fn(), onContentPlugin = jest.fn()
  await act(async () => { view = Renderer.create(<ConnectionsScreen onFeishu={jest.fn()} onMcp={onMcp} onContentPlugin={onContentPlugin} />) })
  const buttons = view.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'button')
  expect(buttons.filter(node => node.props.accessibilityLabel === 'MCP 工具')).toHaveLength(1)
  expect(buttons.some(node => node.props.accessibilityLabel === '全文翻译 · MCP')).toBe(false)
  expect(JSON.stringify(view.toJSON())).toContain('中英文全文翻译')
  expect(JSON.stringify(view.toJSON())).toContain('内容操作')
  await act(async () => press('MCP 工具'))
  expect(onMcp).toHaveBeenCalledTimes(1)
  expect(onContentPlugin).not.toHaveBeenCalled()
  await act(async () => press('流程图整理'))
  expect(onContentPlugin).toHaveBeenCalledWith('diagram')
})

test('keeps Feishu and contextual return available without a content-plugin callback', async () => {
  const onBack = jest.fn(), onFeishu = jest.fn()
  await act(async () => { view = Renderer.create(<ConnectionsScreen onBack={onBack} onFeishu={onFeishu} onMcp={jest.fn()} />) })
  const buttons = view.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'button')
  await act(async () => press('飞书'))
  await act(async () => press('返回设置'))
  expect(onFeishu).toHaveBeenCalledTimes(1)
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(buttons.some(node => node.props.accessibilityLabel === '流程图整理')).toBe(false)
})
