import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TextInput } from 'react-native'
import { Field } from '../src/components/Field'

let view: Renderer.ReactTestRenderer
afterEach(async () => { if (view) await act(async () => view.unmount()) })

test('a hidden visual label still names the input', async () => {
  await act(async () => { view = Renderer.create(<Field label="搜索笔记" hideLabel />) })
  expect(view.root.findByType(TextInput).props.accessibilityLabel).toBe('搜索笔记')
})

test('explicit accessible names are not overwritten by a short visual label', async () => {
  await act(async () => { view = Renderer.create(<Field label="标题" accessibilityLabel="笔记标题" />) })
  expect(view.root.findByType(TextInput).props.accessibilityLabel).toBe('笔记标题')
})

test('the required label names both the visible title and the input', async () => {
  await act(async () => { view = Renderer.create(<Field label="笔记标题" />) })
  expect(view.root.findByType(TextInput).props.accessibilityLabel).toBe('笔记标题')
  expect(view.root.findAll(node => node.props.children === '笔记标题').length).toBeGreaterThan(0)
})

test('an empty accessible override falls back to the label and preserves field callbacks', async () => {
  const focus = jest.fn(), blur = jest.fn(), change = jest.fn()
  await act(async () => { view = Renderer.create(<Field label="链接" accessibilityLabel=" " editable={false} onFocus={focus} onBlur={blur} onChangeText={change} />) })
  const input = view.root.findByType(TextInput)
  expect(input.props.accessibilityLabel).toBe('链接')
  expect(input.props.editable).toBe(false)
  await act(async () => { input.props.onFocus({}); input.props.onBlur({}); input.props.onChangeText('https://example.com') })
  expect(focus).toHaveBeenCalledTimes(1)
  expect(blur).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenCalledWith('https://example.com')
})
