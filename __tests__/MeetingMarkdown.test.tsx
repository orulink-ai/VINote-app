import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { MeetingMarkdown } from '../src/components/MeetingMarkdown'
import { Image, StyleSheet } from 'react-native'
import { ContentImage } from '../src/components/ContentImage'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner'), sessionRevision: jest.fn(() => 1) }))
const originalURL = globalThis.URL
beforeAll(() => { globalThis.URL = require('react-native/Libraries/Blob/URL').URL })
afterAll(() => { globalThis.URL = originalURL })

test('plain timestamps and range starts replay without turning code or existing links into seek actions', () => {
  const seek = jest.fn()
  let view!: Renderer.ReactTestRenderer
  act(() => { view = Renderer.create(<MeetingMarkdown content={'讨论 [01:23]、[03:00–03:10]。`[00:05]` [原链接 [04:00]](https://example.invalid)'} onTimestamp={seek} />) })
  const link = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]
  act(() => { link('回听[01:23]').props.onPress(); link('回听[03:00–03:10]').props.onPress() })
  expect(seek.mock.calls).toEqual([[83], [180]])
  expect(link('回听[00:05]')).toBeUndefined()
  expect(link('回听[04:00]')).toBeUndefined()
  act(() => view.unmount())
})

test('saved or generated Markdown retains its text and requires each external image click again for a new version', async () => {
  const source = '# 原文\n\n![图表](https://images.example/a.png)\n\n保留正文'
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MeetingMarkdown content={source} />) })
  expect(view.root.findAllByType(Image)).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('保留正文')
  const button = view.root.findAll(node => node.props?.accessibilityLabel === '加载图片：图表（images.example）' && typeof node.props.onPress === 'function')[0]
  await act(async () => { button.props.onPress() })
  expect(view.root.findAllByType(Image)).toHaveLength(1)
  await act(async () => { view.update(<MeetingMarkdown content={`${source}\n\n另一版本`} />) })
  expect(view.root.findAllByType(Image)).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('另一版本')
  act(() => view.unmount())
})

test('image blocks fill the paragraph width before loading and after success or failure without dropping surrounding text', async () => {
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MeetingMarkdown content={'前文\n\n![图片](https://images.example/a.png)\n\n后文'} />) })
  const expectBlock = () => {
    const block = view.root.findByType(ContentImage).parent!
    expect(StyleSheet.flatten(block.props.style)).toEqual(expect.objectContaining({ width: '100%', flexShrink: 0 }))
    const tree = JSON.stringify(view.toJSON())
    expect(tree).toContain('前文')
    expect(tree).toContain('后文')
  }
  const press = async () => { await act(async () => { view.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0].props.onPress() }) }
  expectBlock()
  expect(view.root.findAllByType(Image)).toHaveLength(0)
  await press()
  expectBlock()
  expect(StyleSheet.flatten(view.root.findByType(Image).props.style).width).toBe('100%')
  await act(async () => { view.root.findByType(Image).props.onError() })
  expectBlock()
  expect(JSON.stringify(view.toJSON())).toContain('图片加载失败')
  await press()
  await act(async () => { view.root.findByType(Image).props.onLoad() })
  expectBlock()
  expect(view.root.findAllByType(Image)).toHaveLength(1)
  act(() => view.unmount())
})
