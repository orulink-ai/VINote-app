import Storage from '@react-native-async-storage/async-storage'
import { apiJson } from './api'
import { readAccountId } from './storage'
export type CloudModel = { id: string; modelType: 'asr' | 'llm'; runtimeStatus: string }
export type ModelSelection = { asr_model: string; llm_model: string }
async function key() {
  const account = await readAccountId()
  if (!account) throw new Error('请重新登录')
  return `vinote:${account}:models`
}
export async function loadModels() { return (await apiJson<{ data: CloudModel[] }>('/v1/models')).data }
export async function loadSelection(): Promise<ModelSelection> {
  const saved = await Storage.getItem(await key())
  return saved ? JSON.parse(saved) : apiJson<ModelSelection>('/v1/default-models')
}
export async function saveSelection(selection: ModelSelection) {
  const models = await loadModels()
  for (const kind of ['asr', 'llm'] as const) {
    if (!models.some(m => m.id === selection[`${kind}_model`] && m.modelType === kind && m.runtimeStatus === 'available')) throw new Error('所选模型不可用，请刷新后重新选择')
  }
  await Storage.setItem(await key(), JSON.stringify(selection))
  return selection
}
