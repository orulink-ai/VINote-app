import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { LayoutAnimation, Text } from 'react-native'
import { DetailDisclosure } from '../src/components/DetailDisclosure'
import { useReducedMotion } from '../src/design-system/motion'

jest.mock('../src/design-system/motion', () => ({ useReducedMotion: jest.fn() }))

test.each([true, false])('disclosure respects reduced motion: %s', async reduced => {
  jest.mocked(useReducedMotion).mockReturnValue(reduced)
  const animation = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<DetailDisclosure title="详情"><Text>内容</Text></DetailDisclosure>) })
  const toggle = () => view.root.findAll(node => node.props.accessibilityLabel === '详情' && typeof node.props.onPress === 'function')[0]
  expect(toggle().props.accessibilityState.expanded).toBe(false)
  await act(async () => toggle().props.onPress())
  expect(toggle().props.accessibilityState.expanded).toBe(true)
  expect(animation).toHaveBeenCalledTimes(reduced ? 0 : 1)
  await act(async () => view.unmount())
  animation.mockRestore()
})
