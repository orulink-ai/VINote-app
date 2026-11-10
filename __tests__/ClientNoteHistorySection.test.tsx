import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { ClientNoteHistorySection } from '../src/components/ClientNoteHistorySection'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { Text } from '../src/components/AppText'

test('shows each task status and opens only an unambiguously associated saved note', async () => {
  const onOpen = jest.fn()
  const items = [
    { operationId: 'a', taskId: 'one', title: '资料 A', submittedAt: '', status: 'running' as const, message: '正在整理' },
    { operationId: 'b', taskId: 'two', title: '资料 B', submittedAt: '', status: 'success' as const, message: '已保存' },
  ]
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<ClientNoteHistorySection items={items} notes={[{ id: 'note-b', task_id: 'two' }]} onOpen={onOpen} />) })
  const text = view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
  expect(text).toContain('资料 A'); expect(text).toContain('资料 B'); expect(text).toContain('处理中')
  const buttons = view.root.findAllByType(PrimaryButton)
  expect(buttons).toHaveLength(1)
  await act(async () => buttons[0].props.onPress())
  expect(onOpen).toHaveBeenCalledWith(items[1], 'note-b')
  await act(async () => view.unmount())
})
