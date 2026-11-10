import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TasksScreen } from '../src/screens/TasksScreen'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { AsyncState } from '../src/components/AsyncState'
import { Text } from '../src/components/AppText'
import { readIntake } from '../src/lib/noteIntake'
import { readAccountId } from '../src/lib/storage'
import FS from 'react-native-fs'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { useRecordingProgress } from '../src/features/recording/useRecordingProgress'
import { ProcessingProgress } from '../src/components/ProcessingProgress'
import { listNotes } from '../src/lib/notes'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(), sessionRevision: jest.fn(() => 90) }))
jest.mock('../src/lib/workspace', () => ({ readWorkspace: jest.fn(), subscribeWorkspace: jest.fn(() => () => {}), syncWorkspace: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://source.example', integrationJson: jest.fn(async () => []) }))
jest.mock('../src/lib/noteIntake', () => ({ readIntake: jest.fn(), intakeFileName: jest.fn(file => file.name), recoverIntake: jest.fn(), inspectIntake: jest.fn(), submitIntake: jest.fn(), writeIntake: jest.fn() }))
jest.mock('../src/lib/mcp', () => ({ mcpApi: jest.fn(async () => ({ runs: [] })), runLabels: {} }))
jest.mock('../src/lib/feishu', () => ({ flushAutomaticDeliveries: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn(async () => []) }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(async () => []) }))
jest.mock('../src/features/recording/useRecordingProgress', () => ({ useRecordingProgress: jest.fn(() => null) }))
jest.mock('react-native-fs', () => ({ exists: jest.fn(), stat: jest.fn(), getFSInfo: jest.fn(async () => ({ freeSpace: 1073741824 })) }))

let view: Renderer.ReactTestRenderer, counter = 0
const pending = { mode: 'url', url: 'https://example.org/doc', operationId: 'original-operation', generationOrigin: 'https://source.example', uncertain: true, receiptState: 'unknown' }
const props = { onBack: jest.fn(), onOpen: jest.fn(), onRecording: jest.fn(), onMcp: jest.fn(), onIntake: jest.fn() }
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
const buttons = () => view.root.findAllByType(PrimaryButton)
beforeEach(() => { jest.clearAllMocks(); (listNotes as jest.Mock).mockResolvedValue([]); (listRecordings as jest.Mock).mockResolvedValue([]); (useRecordingProgress as jest.Mock).mockReturnValue(null); (readAccountId as jest.Mock).mockResolvedValue(`owner-intake-${++counter}`); (FS.getFSInfo as jest.Mock).mockResolvedValue({ freeSpace: 1073741824 }); (readIntake as jest.Mock).mockResolvedValue(pending) })
afterEach(async () => { if (view) await act(async () => view.unmount()) })

test('recording task summarizes current status and opens the same recording without writing', async () => {
  ;(listRecordings as jest.Mock).mockResolvedValue([{ id: 'original-record', title: '原录音', uri: 'file:///original.m4a', createdAt: '', duration: 4680 }])
  ;(useRecordingProgress as jest.Mock).mockReturnValue({ owner: `owner-intake-${counter + 1}`, recordId: 'original-record', text: '转写：正在等待服务\n说话人：本机分析 42%', speakerPercent: 42 })
  await act(async () => { view = Renderer.create(<TasksScreen {...props} />) })
  expect(view.root.findAllByType(ProcessingProgress)).toHaveLength(0)
  expect(text()).toContain('正在等待服务')
  await act(async () => view.root.findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.endsWith('，查看详情') && typeof node.props.onPress === 'function')[0].props.onPress())
  expect(props.onRecording).toHaveBeenCalledWith('original-record')
  expect(jest.requireMock('../src/lib/noteIntake').submitIntake).not.toHaveBeenCalled()
})
test('saved recording stays in task history only with its confirmed associated note', async () => {
  ;(listRecordings as jest.Mock).mockResolvedValue([{ id: 'original-record', title: '完成的会议', noteId: 'note-1', uri: 'file:///original.m4a', createdAt: '', duration: 20 }])
  ;(listNotes as jest.Mock).mockResolvedValue([{ id: 'note-1', task_id: 'original-record' }])
  await act(async () => { view = Renderer.create(<TasksScreen {...props} />) })
  expect(text()).toContain('完成的会议')
  expect(text()).toContain('纪要已保存')
})

test('current unknown receipt opens only its exact bound source target and IDs start collapsed', async () => {
  await act(async () => { view = Renderer.create(<TasksScreen {...props} />) })
  expect(text()).toContain('笔记来源任务')
  expect(text()).toContain('提交结果待核验')
  expect(text()).not.toContain('提交编号：')
  await act(async () => buttons().find(node => node.props.title === '开发诊断')!.props.onPress())
  expect(text()).toContain('original-operation')
  await act(async () => buttons().find(node => node.props.title === '返回来源页核验')!.props.onPress())
  expect(props.onIntake).toHaveBeenCalledWith({ owner: `owner-intake-${counter}`, generationOrigin: 'https://source.example', operationId: 'original-operation', taskId: undefined })
  const intake = jest.requireMock('../src/lib/noteIntake')
  for (const name of ['recoverIntake', 'inspectIntake', 'submitIntake', 'writeIntake']) expect(intake[name]).not.toHaveBeenCalled()
  expect(jest.requireMock('../src/lib/workspace').syncWorkspace).not.toHaveBeenCalled()
})
test('missing bridge and mismatched service have no clickable recovery placeholder', async () => {
  await act(async () => { view = Renderer.create(<TasksScreen {...props} onIntake={undefined} />) })
  expect(buttons().some(node => node.props.title === '返回来源页核验')).toBe(false)
  ;(readIntake as jest.Mock).mockResolvedValue({ ...pending, generationOrigin: 'https://other.example' })
  await act(async () => buttons().find(node => node.props.title === '刷新当前状态')!.props.onPress())
  expect(text()).toContain('原提交属于其他处理服务')
  expect(props.onIntake).not.toHaveBeenCalled()
})
test('replacement of current slot blocks the old action and preserves changed-state message', async () => {
  await act(async () => { view = Renderer.create(<TasksScreen {...props} />) })
  ;(readIntake as jest.Mock).mockResolvedValue({ ...pending, operationId: 'another-operation' })
  await act(async () => buttons().find(node => node.props.title === '返回来源页核验')!.props.onPress())
  expect(props.onIntake).not.toHaveBeenCalled()
  expect(view.root.findAllByType(AsyncState).some(node => String(node.props.error).includes('当前来源任务已变化'))).toBe(true)
  expect(buttons().some(node => node.props.title === '返回来源页核验')).toBe(false)
})
test('read failure differs from empty task slot and retry never submits', async () => {
  ;(readIntake as jest.Mock).mockRejectedValue(new Error('本机回执读取失败'))
  await act(async () => { view = Renderer.create(<TasksScreen {...props} />) })
  expect(text()).not.toContain('暂无待处理的笔记来源')
  ;(readIntake as jest.Mock).mockResolvedValue({ mode: 'url', url: 'unfinished input' })
  await act(async () => buttons().find(node => node.props.title === '重新读取来源任务')!.props.onPress())
  expect(text()).not.toContain('暂无待处理的笔记来源')
  expect(jest.requireMock('../src/lib/noteIntake').submitIntake).not.toHaveBeenCalled()
})
test('dataOnly does not read intake and shows refresh status only while updating', async () => {
  await act(async () => { view = Renderer.create(<TasksScreen {...props} dataOnly />) })
  expect(readIntake).not.toHaveBeenCalled()
  const slot = () => view.root.findAll(node => node.props.testID === 'tasks-read-status')[0]
  expect(slot()).toBeUndefined()
  let complete!: (value: unknown) => void
  ;(FS.getFSInfo as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  await act(async () => { buttons().find(node => node.props.title === '刷新当前状态')!.props.onPress(); await Promise.resolve() })
  expect(slot()).toBeDefined()
  expect(text()).toContain('正在更新状态')
  expect(view.root.findAllByType(AsyncState).some(node => node.props.loading)).toBe(false)
  await act(async () => { complete({ freeSpace: 1073741824 }) })
  expect(slot()).toBeUndefined()
  expect(text()).not.toContain('正在更新状态')
})

test('production hides diagnostics while recovery still uses exact original identity', async () => {
  const previous = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false
  try {
    await act(async () => { view = Renderer.create(<TasksScreen {...props} />) })
    expect(text()).not.toContain('original-operation')
    expect(text()).not.toContain('回执')
    expect(buttons().some(node => node.props.title === '开发诊断')).toBe(false)
    await act(async () => buttons().find(node => node.props.title === '返回来源页核验')!.props.onPress())
    expect(props.onIntake).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'original-operation' }))
    expect(jest.requireMock('../src/lib/noteIntake').submitIntake).not.toHaveBeenCalled()
  } finally { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = previous }
})
