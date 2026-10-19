import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { IntakeGenerationConfirmation } from '../src/components/IntakeGenerationConfirmation'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { loadSelection, loadModels } from '../src/lib/models'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(async () => [
  { id: 'asr', modelType: 'asr', runtimeStatus: 'available' },
  { id: 'chosen', modelType: 'llm', runtimeStatus: 'available' },
]), loadSelection: jest.fn(async () => ({ asr_model: 'asr', llm_model: 'chosen' })) }))
beforeEach(() => {
  jest.clearAllMocks(); transitionIdentity('alice')
  jest.mocked(loadSelection).mockReset().mockResolvedValue({ asr_model: 'asr', llm_model: 'chosen' })
})
async function mount(media = true, confirm = jest.fn()) {
  const cancel = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<IntakeGenerationConfirmation owner="alice" media={media} disabled={false} onConfirm={confirm} onCancel={cancel} />) })
  const press = (title: string) => view.root.findAll(n => n.props.title === title && typeof n.props.onPress === 'function')[0].props.onPress()
  return { view, confirm, cancel, press }
}
test('loading/catalog reads never submit; cancellation is distinct; confirmation freezes models only once', async () => {
  const c = await mount()
  expect(c.confirm).not.toHaveBeenCalled()
  act(() => c.press('取消')); expect(c.cancel).toHaveBeenCalledTimes(1)
  // Changing defaults elsewhere does not change the pair shown in this sheet.
  jest.mocked(loadSelection).mockResolvedValueOnce({ asr_model: 'other', llm_model: 'other' })
  await act(async () => { c.press('确认模型并开始生成'); c.press('确认模型并开始生成') })
  expect(c.confirm).toHaveBeenCalledTimes(1)
  expect(c.confirm).toHaveBeenCalledWith({ asr_model: 'asr', llm_model: 'chosen' })
  act(() => c.view.unmount())
})
test('owner ABA invalidates an existing confirmation', async () => {
  const c = await mount()
  act(() => { transitionIdentity('bob'); transitionIdentity('alice'); c.press('确认模型并开始生成') })
  expect(c.confirm).not.toHaveBeenCalled()
  expect(c.view.root.findAll(n => typeof n.type === 'string' && n.props.accessibilityRole === 'radio')).toHaveLength(0)
  expect(c.view.root.findAll(n => n.props.title === '确认模型并开始生成')[0].props.disabled).toBe(true)
  act(() => c.view.unmount())
})
test('text sources do not offer or require ASR', async () => {
  const c = await mount(false)
  expect(c.view.root.findAll(n => typeof n.type === 'string' && n.props.accessibilityRole === 'radio' && n.props.accessibilityState).length).toBe(1)
  act(() => c.view.unmount())
})
test('catalog failure can be reread inside the same sheet without submitting or mutating a draft', async () => {
  jest.mocked(loadModels).mockRejectedValueOnce(new Error('offline catalog failure'))
  const c = await mount()
  expect(c.view.root.findAll(n => n.props.title === '确认模型并开始生成')[0].props.disabled).toBe(true)
  await act(async () => { c.press('重新读取模型') })
  expect(c.view.root.findAll(n => n.props.title === '确认模型并开始生成')[0].props.disabled).toBe(false)
  expect(c.confirm).not.toHaveBeenCalled()
  expect(loadModels).toHaveBeenCalledTimes(2)
  act(() => c.view.unmount())
})
test('a synchronous parent failure releases the confirm lock for a new explicit click', async () => {
  const confirm = jest.fn().mockImplementationOnce(() => { throw new Error('before submit') }).mockImplementation(() => {})
  const c = await mount(true, confirm)
  await act(async () => { c.press('确认模型并开始生成') })
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(c.view.root.findAll(n => n.props.title === '确认模型并开始生成')[0].props.disabled).toBe(false)
  await act(async () => { c.press('确认模型并开始生成') })
  expect(confirm).toHaveBeenCalledTimes(2)
  act(() => c.view.unmount())
})
