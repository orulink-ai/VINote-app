import Storage from '@react-native-async-storage/async-storage'
import { apiJson } from './api'
import { readAccountId } from './storage'
export type CloudModel = { id: string; modelType: 'asr' | 'llm'; runtimeStatus: string }
export type ModelSelection = { asr_model: string; llm_model: string }
const MODEL_CACHE_MS = 60_000
type ModelCache = { account: string; models?: CloudModel[]; expiresAt: number; inFlight?: Promise<CloudModel[]> }
let modelCache: ModelCache | undefined
async function key() {
  const account = await readAccountId()
  if (!account) throw new Error('请重新登录')
  return `vinote:${account}:models`
}
export async function loadModels(forceRefresh = false): Promise<CloudModel[]> {
  const account = await readAccountId()
  if (!account) throw new Error('请重新登录')
  if (modelCache?.account !== account) modelCache = { account, expiresAt: 0 }
  const entry = modelCache
  if (entry.inFlight) return entry.inFlight
  if (!forceRefresh && entry.models && Date.now() < entry.expiresAt) return entry.models
  const inFlight = (async () => {
    const response = await apiJson<{ data: CloudModel[] }>('/v1/models')
    if (!Array.isArray(response?.data)) throw new Error('模型列表返回格式异常，请刷新重试')
    if (await readAccountId() !== account) throw new Error('账号已切换，请重新加载模型')
    if (modelCache === entry) {
      entry.models = response.data
      entry.expiresAt = Date.now() + MODEL_CACHE_MS
    }
    return response.data
  })()
  entry.inFlight = inFlight
  try { return await inFlight }
  finally { if (entry.inFlight === inFlight) entry.inFlight = undefined }
}
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
