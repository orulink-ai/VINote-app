import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { NoteIntakeScreen } from '../src/screens/NoteIntakeScreen'
import { BottomActionSheet } from '../src/components/BottomActionSheet'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { AsyncState } from '../src/components/AsyncState'
import { Text } from '../src/components/AppText'
import { inspectIntake, readIntake, writeIntake, submitIntake, type IntakeDraft } from '../src/lib/noteIntake'
import { integrationJson } from '../src/lib/integration'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { ApiError } from '../src/lib/errors'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/localFiles', () => ({ importLocalFile: jest.fn(), verifyLocalFile: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://generation.example', verifyContentService: jest.fn(async () => ({ content_service_protocol: 1, generation: true, sync: false, max_upload_bytes: 134217728, video_url: true })), integrationJson: jest.fn() }))
jest.mock('../src/lib/noteIntake', () => ({ readIntake: jest.fn(), writeIntake: jest.fn(), inspectIntake: jest.fn(), recoverIntake: jest.fn(), submitIntake: jest.fn(), intakeFileName: jest.fn(), intakeSourceType: jest.fn() }))

const context = {
  task_id: 'original-task', source: { title: '原文档', type: 'document' }, requires_confirmation: true, can_confirm: true,
  selection: { mode: 'cloud', server_url: 'https://models.example', asr_model: 'original-asr', llm_model: 'original-llm' },
}
let stored: IntakeDraft, view: Renderer.ReactTestRenderer | undefined
const posts = () => jest.mocked(integrationJson).mock.calls.filter(call => call[1]?.method === 'POST')
const buttons = () => view!.root.findAllByType(PrimaryButton)
const text = () => view!.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
async function press(title: string) { await act(async () => { await buttons().find(node => node.props.title === title)!.props.onPress() }) }
async function mount() { await act(async () => { view = Renderer.create(<NoteIntakeScreen onBack={jest.fn()} onSaved={jest.fn()} />) }) }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(integrationJson).mockReset()
  jest.mocked(inspectIntake).mockReset()
  transitionIdentity('owner')
  stored = { mode: 'url', url: 'https://source.example/doc', taskId: 'original-task', operationId: 'original-operation', generationOrigin: 'https://generation.example', receiptState: 'accepted' }
  jest.mocked(readAccountId).mockResolvedValue('owner')
  jest.mocked(readIntake).mockImplementation(async () => stored)
  jest.mocked(writeIntake).mockImplementation(async (_owner, value) => { stored = value })
  jest.mocked(inspectIntake).mockResolvedValue({ status: { status: 'failed', retryable: true } })
  jest.mocked(integrationJson).mockImplementation(async (_path, init) => {
    if (init?.method === 'GET') return context as never
    throw new ApiError('原任务缺少冻结模型', 409)
  })
})
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined })

test('409 opens read-only context; only explicit confirmation sends the exact reviewed selection', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  expect(view!.root.findByType(BottomActionSheet).props.visible).toBe(true)
  expect(text()).toContain('https://models.example'); expect(text()).toContain('original-asr'); expect(text()).toContain('original-llm')
  expect(posts()).toHaveLength(1)
  expect(jest.mocked(integrationJson).mock.calls[1]).toEqual(['/api/task/original-task/model-confirmation', { method: 'GET', headers: { 'Cache-Control': 'no-cache' } }, 'owner', 45000, expect.any(Function)])
  jest.mocked(integrationJson).mockImplementation(async (_path, init) => {
    if (init?.method === 'GET') return context as never
    expect(stored.retryUncertain).toBe(true)
    return { task_id: 'original-task', status: 'preparing' } as never
  })
  await press('确认以上模型并重试原任务'); await flush()
  const post = posts()[1]
  expect(post[0]).toBe('/api/task/original-task/retry')
  expect(JSON.parse(post[1]!.body as string)).toEqual({ confirmed: true, ...context.selection })
  expect(stored.retryUncertain).toBe(false)
  expect(view!.root.findAllByType(BottomActionSheet)).toHaveLength(0)
  expect(submitIntake).not.toHaveBeenCalled()
})

test('loading can return and discards a late context without posting', async () => {
  let finish!: (value: unknown) => void
  jest.mocked(integrationJson).mockImplementation(async (_path, init) => {
    if (init?.method === 'GET') return new Promise(resolve => { finish = resolve }) as never
    throw new ApiError('missing', 409)
  })
  await mount()
  await act(async () => { void buttons().find(node => node.props.title === '重试处理原任务')!.props.onPress(); await Promise.resolve() })
  await flush()
  expect(view!.root.findAllByType(AsyncState).some(node => node.props.loadingLabel === '正在读取原任务恢复信息…' && node.props.loading)).toBe(true)
  await press('返回原任务')
  await act(async () => { finish(context) }); await flush()
  expect(view!.root.findAllByType(BottomActionSheet)).toHaveLength(0)
  expect(posts()).toHaveLength(1)
})

test('context GET failure has an in-place GET retry without another POST', async () => {
  await mount()
  jest.mocked(integrationJson).mockRejectedValueOnce(new ApiError('missing', 409)).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(context as never)
  await press('重试处理原任务'); await flush()
  expect(text()).toContain('读取失败')
  await press('重新读取模型恢复信息'); await flush()
  expect(text()).toContain('original-asr'); expect(posts()).toHaveLength(1)
})

test.each(['owner', 'epoch', 'task', 'origin'])('changed %s blocks confirmation without another POST', async changed => {
  await mount(); await press('重试处理原任务'); await flush()
  if (changed === 'owner') jest.mocked(readAccountId).mockResolvedValue('other')
  if (changed === 'epoch') { transitionIdentity('other'); transitionIdentity('owner') }
  if (changed === 'task') stored = { ...stored, taskId: 'newer-task' }
  if (changed === 'origin') stored = { ...stored, generationOrigin: 'https://another.example' }
  await press('确认以上模型并重试原任务'); await flush()
  expect(posts()).toHaveLength(1)
  expect(view!.root.findAllByType(AsyncState).some(node => !!node.props.error)).toBe(true)
})

test('changed models require a new review instead of dispatching the old confirmation', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  jest.mocked(integrationJson).mockResolvedValue({ ...context, selection: { ...context.selection, llm_model: 'changed-llm' } } as never)
  await press('确认以上模型并重试原任务'); await flush()
  expect(posts()).toHaveLength(1); expect(text()).toContain('changed-llm'); expect(text()).toContain('重新核对')
})

test.each(['transport', 'malformed'])('unknown %s result survives reopen and permits only status queries', async failure => {
  await mount(); await press('重试处理原任务'); await flush()
  jest.mocked(integrationJson).mockImplementation(async (_path, init) => {
    if (init?.method === 'GET') return context as never
    if (failure === 'transport') throw new Error('connection lost')
    return { task_id: 'other-task', status: 'preparing' } as never
  })
  await press('确认以上模型并重试原任务'); await flush()
  expect(stored.retryUncertain).toBe(true)
  expect(text()).toContain('不会再次发送')
  await press('返回并查询原任务')
  await act(async () => view!.unmount()); view = undefined
  await mount(); await press('重新查询结果'); await flush()
  expect(posts()).toHaveLength(2)
  expect(buttons().some(node => ['重试处理原任务', '确认模型并恢复原任务'].includes(node.props.title))).toBe(false)
  expect(submitIntake).not.toHaveBeenCalled()
})

test('model unavailable or protocol incomplete cannot be confirmed', async () => {
  await mount()
  jest.mocked(integrationJson).mockRejectedValueOnce(new ApiError('missing', 409)).mockResolvedValue({ ...context, can_confirm: false } as never)
  await press('重试处理原任务'); await flush()
  expect(buttons().find(node => node.props.title === '确认以上模型并重试原任务')!.props.disabled).toBe(true)
  jest.mocked(integrationJson).mockResolvedValue({ ...context, selection: undefined } as never)
  await press('重新读取模型恢复信息'); await flush()
  expect(text()).toContain('协议不完整')
  expect(buttons().some(node => node.props.title === '确认以上模型并重试原任务')).toBe(false)
  expect(posts()).toHaveLength(1)
})

test('task running at confirmation readback is queried without posting', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  jest.mocked(inspectIntake).mockResolvedValue({ status: { status: 'summarizing', retryable: true } })
  await press('确认以上模型并重试原任务'); await flush()
  expect(posts()).toHaveLength(1)
  expect(view!.root.findAllByType(BottomActionSheet)).toHaveLength(0)
})

test('confirmation rejection reloads context and never silently sends an empty retry', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  await press('确认以上模型并重试原任务'); await flush()
  expect(stored.retryUncertain).toBe(false)
  expect(stored.modelConfirmationRequired).toBe(true)
  expect(buttons().some(node => node.props.title === '确认以上模型并重试原任务')).toBe(false)
  await press('重新读取模型恢复信息'); await flush()
  expect(posts()).toHaveLength(2)
  expect(JSON.parse(posts()[1][1]!.body as string).confirmed).toBe(true)
})

test('closing then reopening required confirmation only reads GET', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  await press('返回原任务')
  await press('确认模型并恢复原任务'); await flush()
  expect(posts()).toHaveLength(1)
})

test('failure saving retry intent blocks dispatch', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  jest.mocked(writeIntake).mockRejectedValueOnce(new Error('存储失败'))
  await press('确认以上模型并重试原任务'); await flush()
  expect(posts()).toHaveLength(1)
  expect(stored.retryUncertain).toBe(false)
  expect(text()).toContain('存储失败')
})

test('double confirm dispatches once; late acknowledgement never overwrites a newer source', async () => {
  await mount(); await press('重试处理原任务'); await flush()
  let finish!: (value: unknown) => void
  jest.mocked(integrationJson).mockImplementation(async (_path, init) => {
    if (init?.method === 'GET') return context as never
    return new Promise(resolve => { finish = resolve }) as never
  })
  await act(async () => {
    const confirm = buttons().find(node => node.props.title === '确认以上模型并重试原任务')!
    void confirm.props.onPress(); void confirm.props.onPress(); await Promise.resolve()
  }); await flush()
  expect(posts()).toHaveLength(2)
  stored = { ...stored, taskId: 'newer-task', operationId: 'newer-operation' }
  const writes = jest.mocked(writeIntake).mock.calls.length
  await act(async () => { finish({ task_id: 'original-task', status: 'preparing' }) }); await flush()
  expect(stored.taskId).toBe('newer-task')
  expect(writeIntake).toHaveBeenCalledTimes(writes)
  expect(text()).toContain('不会再次发送')
})
