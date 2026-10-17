import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { MeetingDetailWorkspace } from '../src/components/MeetingDetailWorkspace'
import { chatCompletion } from '../src/lib/chatCompletion'
jest.mock('react-native-nitro-sound', () => ({ stopPlayer: jest.fn(async () => {}), removePlayBackListener: jest.fn(), removePlaybackEndListener: jest.fn() }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(async () => []) }))
jest.mock('../src/components/FeishuDeliveryPanel', () => ({ FeishuDeliveryPanel: () => null }))
jest.mock('../src/lib/chatCompletion', () => ({ chatCompletion: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(async () => ({ llm_model: 'model' })) }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))

test('empty chat response keeps the question and allows a successful retry', async () => {
  jest.mocked(chatCompletion).mockResolvedValueOnce({ choices: [{ message: { content: '  ' } }] } as never).mockResolvedValueOnce({ choices: [{ message: { content: '未明确负责人。' } }] } as never)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MeetingDetailWorkspace note={{ id: 'note', source_type: 'meeting_recording', content: '# 会议', title: '会议' } as never} onUpdated={jest.fn()} initialTab="对话" />) })
  const input = () => view.root.findAll(node => node.props.accessibilityLabel === '会议问题' && typeof node.props.onChangeText === 'function')[0]
  const press = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]
  await act(async () => input().props.onChangeText('负责人是谁？'))
  await act(async () => press('发送').props.onPress())
  expect(input().props.value).toBe('负责人是谁？')
  expect(press('重试提问')).toBeDefined()
  await act(async () => press('重试提问').props.onPress())
  expect(input().props.value).toBe('')
  expect(JSON.stringify(view.toJSON())).toContain('未明确负责人。')
  await act(async () => view.unmount())
})
