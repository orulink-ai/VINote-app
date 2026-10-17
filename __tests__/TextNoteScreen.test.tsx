import { loadModels } from '../src/lib/models'
import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TextInput } from 'react-native'
import Storage from '@react-native-async-storage/async-storage'
import { TextNoteScreen } from '../src/screens/TextNoteScreen'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { chatCompletion } from '../src/lib/chatCompletion'
import { createTextNote } from '../src/lib/notes'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'text-owner') }))
jest.mock('../src/lib/integration', () => ({ operationId: jest.fn(() => 'original-operation') }))
jest.mock('../src/lib/chatCompletion', () => ({ chatCompletion: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ createTextNote: jest.fn() }))
jest.mock('../src/lib/models', () => ({ loadSelection: jest.fn(async () => ({ llm_model: 'chosen' })), loadModels: jest.fn(async () => [{ id: 'chosen', modelType: 'llm', runtimeStatus: 'available' }]) }))
jest.mock('../src/components/MeetingMarkdown', () => ({ MeetingMarkdown: () => null }))
beforeEach(async () => { jest.clearAllMocks(); jest.mocked(loadModels).mockResolvedValue([{ id: 'chosen', modelType: 'llm', runtimeStatus: 'available' }]); await Storage.removeItem('vinote:text-owner:text-draft') })
async function mount() {
  let view!: Renderer.ReactTestRenderer
  const onSaved = jest.fn()
  await act(async () => { view = Renderer.create(<TextNoteScreen onBack={jest.fn()} onSaved={onSaved} />) })
  await act(async () => { view.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '原始文字')!.props.onChangeText('the original evidence') })
  const press = async (title: string) => { await act(async () => { await view.root.findAllByType(PrimaryButton).find(node => node.props.title === title)!.props.onPress() }) }
  return { view, press, onSaved }
}
test('saving a reviewed result retries the same text and never re-runs the model', async () => {
  jest.mocked(chatCompletion).mockResolvedValueOnce({ choices: [{ message: { content: 'draft' } }] } as never).mockResolvedValueOnce({ choices: [{ message: { content: '# reviewed' } }] } as never)
  jest.mocked(createTextNote).mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce({ id: 'saved' } as never)
  const { view, press, onSaved } = await mount()
  await press('整理并核对')
  expect(view.root.findAllByType(PrimaryButton).find(node => node.props.title === '重新整理文字')!.props.secondary).toBe(true)
  await press('保存笔记')
  expect(onSaved).not.toHaveBeenCalled()
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '重试整理文字')).toBe(false)
  await press('重试保存笔记')
  expect(chatCompletion).toHaveBeenCalledTimes(2)
  expect(createTextNote).toHaveBeenNthCalledWith(1, '文字笔记', '# reviewed', 'text-original-operation')
  expect(createTextNote).toHaveBeenNthCalledWith(2, '文字笔记', '# reviewed', 'text-original-operation')
  expect(onSaved).toHaveBeenCalledWith('saved')
  await act(async () => view.unmount())
})
test('direct original saving failure keeps its original body on retry', async () => {
  jest.mocked(createTextNote).mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce({ id: 'saved-original' } as never)
  const { view, press } = await mount()
  await press('直接保存原文笔记')
  await press('重试保存笔记')
  expect(chatCompletion).not.toHaveBeenCalled()
  expect(createTextNote).toHaveBeenLastCalledWith('文字笔记', 'the original evidence', 'text-original-operation')
  await act(async () => view.unmount())
})

test('expired transient summary retries the exact selected model for draft and review', async () => {
  jest.mocked(loadModels).mockResolvedValue([{ id: 'chosen', modelType: 'llm', runtimeStatus: 'not_available', availability: { status: 'service_error', retryAt: Date.now() - 1 } }])
  jest.mocked(chatCompletion).mockResolvedValue({ choices: [{ message: { content: '# reviewed' } }] } as never)
  const { view, press } = await mount()
  await press('整理并核对')
  expect(loadModels).toHaveBeenCalledWith(true)
  expect(chatCompletion).toHaveBeenCalledTimes(2)
  expect(jest.mocked(chatCompletion).mock.calls.every(call => call[0] === 'chosen')).toBe(true)
  await act(async () => view.unmount())
})
test.each(['auth_failed', 'quota_exhausted'])('%s never starts a text model request', async status => {
  jest.mocked(loadModels).mockResolvedValue([{ id: 'chosen', modelType: 'llm', runtimeStatus: 'not_available', availability: { status, retryAt: 1 } }])
  const { view, press } = await mount()
  await press('整理并核对')
  expect(chatCompletion).not.toHaveBeenCalled()
  expect(createTextNote).not.toHaveBeenCalled()
  expect(view.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === '原始文字')!.props.value).toBe('the original evidence')
  await act(async () => view.unmount())
})
