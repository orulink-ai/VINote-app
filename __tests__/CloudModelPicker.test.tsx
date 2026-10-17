import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { CloudModelPicker } from '../src/components/CloudModelPicker'
import { Text } from '../src/components/AppText'
import { loadModels, loadSelection, saveSelection } from '../src/lib/models'
import { PrimaryButton } from '../src/components/PrimaryButton'
jest.mock('../src/lib/models', () => ({ loadModels: jest.fn(), loadSelection: jest.fn(), saveSelection: jest.fn() }))
test.each(['service_error', 'quota_exhausted'])('picker preserves original model and readiness matches %s', async status => {
  jest.mocked(loadModels).mockResolvedValue([
    { id: 'original', modelType: 'asr', runtimeStatus: 'not_available', availability: { status, retryAt: Date.now() - 1 } },
    { id: 'summary', modelType: 'llm', runtimeStatus: 'available' },
  ])
  jest.mocked(loadSelection).mockResolvedValue({ asr_model: 'original', llm_model: 'summary' })
  const ready = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<CloudModelPicker disabled={false} onReady={ready} />) })
  expect(ready).toHaveBeenLastCalledWith(status === 'service_error')
  const text = view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
  expect(text).toContain(status === 'service_error' ? '已选语音模型' : '语音模型 1')
  expect(text).not.toContain('original')
  expect(text).toContain(status === 'service_error' ? '可尝试当前选择' : '原选择保留')
  expect(text).not.toContain('原模型可重试')
  expect(saveSelection).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

const asr = 'asr:6:aliyun:22:paraformer-realtime-v2'
const llm = 'llm:4:luna:6:chosen'
const copy = (view: Renderer.ReactTestRenderer) => view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')
async function mountCatalog(models: Awaited<ReturnType<typeof loadModels>>) {
  jest.clearAllMocks()
  jest.mocked(loadModels).mockResolvedValue(models)
  jest.mocked(loadSelection).mockResolvedValue({ asr_model: asr, llm_model: llm })
  jest.mocked(saveSelection).mockResolvedValue({ asr_model: asr, llm_model: llm })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<CloudModelPicker disabled={false} onReady={jest.fn()} />) })
  return view
}

test('confirmation and choice rows use exact catalog names while saving actual IDs', async () => {
  const models = [
    { id: asr, modelType: 'asr' as const, runtimeStatus: 'available', name: '阿里云语音转写' },
    { id: llm, modelType: 'llm' as const, runtimeStatus: 'available', name: 'Luna 总结' },
  ]
  const view = await mountCatalog(models)
  expect(copy(view)).toContain('阿里云语音转写'); expect(copy(view)).toContain('Luna 总结')
  expect(copy(view)).not.toContain(asr); expect(copy(view)).not.toContain(llm)
  await act(async () => view.root.findByType(PrimaryButton).props.onPress())
  expect(copy(view)).toContain('阿里云语音转写'); expect(copy(view)).not.toContain(asr)
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '确认模型')!.props.onPress())
  expect(saveSelection).toHaveBeenCalledWith({ asr_model: asr, llm_model: llm })
  await act(async () => view.unmount())
})

test('unknown names and wrong-kind matches never decode or expose internal IDs', async () => {
  const models = [
    { id: 'another', modelType: 'asr' as const, runtimeStatus: 'available', name: '另一个模型' },
    { id: asr, modelType: 'llm' as const, runtimeStatus: 'available', name: '错误类型名称' },
    { id: llm, modelType: 'llm' as const, runtimeStatus: 'available', name: llm },
  ]
  const view = await mountCatalog(models)
  expect(copy(view)).toContain('原选择： 已选语音模型')
  expect(copy(view)).toContain('总结模型 2')
  expect(copy(view)).not.toContain(asr); expect(copy(view)).not.toContain(llm)
  expect(copy(view)).not.toContain('paraformer')
  expect(saveSelection).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('unselected transient service health never claims a failed recording or reuse of an original model', async () => {
  const view = await mountCatalog([
    { id: asr, modelType: 'asr', runtimeStatus: 'available' },
    { id: llm, modelType: 'llm', runtimeStatus: 'available' },
    { id: 'new-choice', modelType: 'asr', runtimeStatus: 'not_available', availability: { status: 'service_error', retryAt: Date.now() - 1 } },
  ])
  await act(async () => view.root.findByType(PrimaryButton).props.onPress())
  expect(copy(view)).toContain('可尝试选择')
  expect(copy(view)).not.toContain('可重试'); expect(copy(view)).not.toContain('仍使用原模型')
  expect(saveSelection).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test.each([true, false])('ASR policy %s explains invocation method without disabling model capability selection', async hasPolicy => {
  const ready = jest.fn()
  jest.mocked(loadModels).mockResolvedValue([
    { id: asr, modelType: 'asr', runtimeStatus: 'available', ...(hasPolicy ? { capabilities: { recordedAudio: {
      protocol: 1, supported: true, strategy: 'adaptive_pause', maxSessionAudioBytes: 2097152, policySource: 'service_budget',
    } } } : {}) },
    { id: llm, modelType: 'llm', runtimeStatus: 'available' },
  ])
  jest.mocked(loadSelection).mockResolvedValue({ asr_model: asr, llm_model: llm })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<CloudModelPicker disabled={false} onReady={ready} />) })
  expect(ready).toHaveBeenLastCalledWith(true)
  expect(copy(view)).toContain(hasPolicy ? '适用于录音与会议纪要' : '录音转写尚未就绪')
  expect(copy(view)).not.toContain('模型不支持')
  await act(async () => view.root.findByType(PrimaryButton).props.onPress())
  expect(copy(view)).toContain(hasPolicy ? '始终使用所选模型' : '录音转写尚未就绪')
  await act(async () => view.unmount())
})
