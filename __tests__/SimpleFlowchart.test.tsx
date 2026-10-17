import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { SimpleFlowchart } from '../src/components/SimpleFlowchart'

test('native graph has actual positioned nodes and rotated directed segments, with expansion', () => {
  let view!: Renderer.ReactTestRenderer
  act(() => { view = Renderer.create(<SimpleFlowchart source={'flowchart TD\nA[来源] -->|确认| B[保存]'} />) })
  expect(view.root.findAll(node => node.props.accessibilityLabel === 'A：来源').length).toBeGreaterThan(0)
  expect(view.root.findAll(node => node.props.style?.height === 2 && node.props.style?.transform?.[0]?.rotate).length).toBeGreaterThan(0)
  const control = view.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0]
  act(() => control.props.onPress())
  expect(view.root.findAll(node => node.props.accessibilityState?.expanded === true).length).toBeGreaterThan(0)
  expect(JSON.stringify(view.toJSON())).toContain('收起流程图')
  act(() => view.unmount())
})

test('unsupported unsafe graph retains plaintext source without a native graph or external resource', () => {
  let view!: Renderer.ReactTestRenderer
  const source = 'flowchart TD\nA[<svg onload=run()>]'
  act(() => { view = Renderer.create(<SimpleFlowchart source={source} />) })
  expect(JSON.stringify(view.toJSON())).toContain('暂无法显示此流程图')
  expect(view.root.findAll(node => node.props.style?.height === 2 && node.props.style?.transform).length).toBe(0)
  const control = view.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0]
  act(() => control.props.onPress())
  expect(JSON.stringify(view.toJSON())).toContain('onload=run()')
  expect(view.root.findAll(node => node.props.source?.uri).length).toBe(0)
  act(() => view.unmount())
})
