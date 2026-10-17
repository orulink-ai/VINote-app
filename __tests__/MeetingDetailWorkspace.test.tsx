import React from 'react'
import FS from 'react-native-fs'
import Renderer, { act } from 'react-test-renderer'
import { MeetingDetailWorkspace } from '../src/components/MeetingDetailWorkspace'
import {
  listRecordings,
  renameSpeaker,
} from '../src/features/recording/recordingLibrary'
import { BottomActionSheet } from '../src/components/BottomActionSheet'

test('a file summary uses note labels and does not invent an unavailable recording', async () => {
  jest.mocked(listRecordings).mockClear()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MeetingDetailWorkspace note={{ id: 'source-note', title: '文件总结', source_type: 'file', task_id: 'document-task', transcript: { full_text: '旧版文档正文证据', segments: [{ start: 0, end: 0, text: '文档正文' }] }, content: '# 笔记', created_at: '' } as never} onUpdated={jest.fn()} />) })
  expect(view.root.findAll(node => node.props.testID === 'meeting-player')).toHaveLength(0)
  expect(view.root.findAll(node => node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === '正文').length).toBeGreaterThan(0)
  expect(listRecordings).not.toHaveBeenCalled()
  expect(view.root.findAll(node => node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === '逐字稿')).toHaveLength(0)
  await act(async () => view.unmount())
})

jest.mock('react-native-nitro-sound', () => ({
  stopPlayer: jest.fn(async () => undefined),
  removePlayBackListener: jest.fn(),
  removePlaybackEndListener: jest.fn(),
}))
jest.mock('../src/features/recording/recordingLibrary', () => ({
  listRecordings: jest.fn(),
  renameSpeaker: jest.fn(),
}))
jest.mock('../src/components/FeishuDeliveryPanel', () => ({
  FeishuDeliveryPanel: () => null,
}))
const record = {
  id: 'record',
  title: '会议',
  uri: 'file:///record.m4a',
  createdAt: '',
  duration: 60,
  transcript: '[录音第 0 分钟起]\n讨论安排',
  speakerCheckpoint: {
    version: 1 as const,
    provider: 'sherpa-onnx-1.12.35' as const,
    source: { size: 1, modifiedMs: 1 },
    duration: 60,
    turns: [{ start: 2, end: 10, speakerId: 'speaker_1' }],
  },
}

test('renames inside the timeline sheet and retains the input on a failed save', async () => {
  jest.mocked(FS.exists).mockResolvedValueOnce(true)
  jest.mocked(listRecordings).mockResolvedValue([record])
  jest
    .mocked(renameSpeaker)
    .mockRejectedValueOnce(new Error('本机保存失败'))
    .mockResolvedValueOnce({
      ...record,
      speakerAliases: { speaker_1: '确认的名字' },
    })
  let view!: Renderer.ReactTestRenderer
  await act(async () => {
    view = Renderer.create(
      <MeetingDetailWorkspace
        note={
          {
            id: 'note',
            title: '会议',
            task_id: 'record',
            content: '# 讨论',
            created_at: '',
          } as never
        }
        onUpdated={jest.fn()}
      />,
    )
  })
  const press = (label: string) =>
    view.root.findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === 'function',
    )[0]
  await act(async () => {
    view.root
      .findAll(
        node =>
          node.props.accessibilityRole === 'tab' &&
          typeof node.props.onPress === 'function',
      )[1]
      .props.onPress()
  })
  await act(async () => {
    press('查看0秒起的说话人时间轴').props.onPress()
  })
  await act(async () => {
    press('修改说话人 1名称').props.onPress()
  })
  const input = () =>
    view.root.findAll(
      node =>
        node.props.accessibilityLabel === '说话人名称' &&
        typeof node.props.onChangeText === 'function',
    )[0]
  await act(async () => {
    input().props.onChangeText('确认的名字')
  })
  await act(async () => {
    await press('保存名称').props.onPress()
  })
  expect(input().props.value).toBe('确认的名字')
  expect(JSON.stringify(view.toJSON())).toContain('本机保存失败')
  await act(async () => {
    await press('重试保存名称').props.onPress()
  })
  expect(renameSpeaker).toHaveBeenLastCalledWith(
    record,
    'speaker_1',
    '确认的名字',
  )
  expect(
    view.root
      .findAllByType(BottomActionSheet)
      .find(sheet => sheet.props.title === '说话人时间轴')?.props.visible,
  ).toBe(true)
  await act(async () => view.unmount())
})


jest.mock('../src/lib/feishuDeliveryReturn', () => ({ takeDeliveryReturn: jest.fn(async () => true) }))
test('saved-content restoration opens delivery only after validating the request and forwards settings intent', async () => {
  const { takeDeliveryReturn } = require('../src/lib/feishuDeliveryReturn')
  const { FeishuDeliveryPanel } = require('../src/components/FeishuDeliveryPanel')
  const intent = { noteId: 'saved', noteKey: 'saved', owner: 'owner', epoch: require('../src/lib/sessionIdentity').identityEpoch(), operationId: 'op' }
  const consumed = jest.fn(), settings = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MeetingDetailWorkspace note={{ id: 'saved', title: '正文', source_type: 'text', content: '# Saved' } as never} onUpdated={jest.fn()} onSettings={settings} deliveryReturn={intent} onDeliveryReturnConsumed={consumed} />) })
  expect(takeDeliveryReturn).toHaveBeenCalledWith(intent, 'saved', 'saved')
  expect(consumed).toHaveBeenCalledTimes(1)
  const panel = view.root.findByType(FeishuDeliveryPanel)
  expect(panel.props.returnedFromSettings).toBe(true)
  await act(async () => panel.props.onSettings(intent))
  expect(settings).toHaveBeenCalledWith(intent)
  await act(async () => view.unmount())
})
test('invalid restoration never opens delivery', async () => {
  const { takeDeliveryReturn } = require('../src/lib/feishuDeliveryReturn')
  const { FeishuDeliveryPanel } = require('../src/components/FeishuDeliveryPanel')
  takeDeliveryReturn.mockResolvedValueOnce(false)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MeetingDetailWorkspace note={{ id: 'saved', title: '正文', source_type: 'text', content: '# Saved' } as never} onUpdated={jest.fn()} deliveryReturn={{ noteId: 'other' } as never} />) })
  expect(view.root.findAllByType(FeishuDeliveryPanel)).toHaveLength(0)
  await act(async () => view.unmount())
})
