import type { CloudModel } from './models'

/** Display public catalog metadata; never decode an opaque routing ID. */
export function modelDisplay(model: CloudModel | undefined, kind: 'asr' | 'llm', ordinal?: number) {
  const safe = (value: unknown, publicModel = false) => typeof value === 'string' && value.trim() &&
    (publicModel || value.trim() !== model?.id) && value.length <= 120 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/^(?:asr|llm|tts):/i.test(value.trim()) ? value.trim() : ''
  const name = safe(model?.name)
  if (name) return name
  const publicModel = safe(model?.providerModel, true)
  const provider = ({ aliyun: '阿里云', 'volcengine-asr': '豆包', volcengine: '豆包', codex: 'Codex' } as Record<string, string>)[model?.providerId || '']
  if (publicModel) return provider ? `${provider} · ${publicModel}` : publicModel
  return ordinal === undefined ? kind === 'asr' ? '已选语音模型' : '已选总结模型' : `${kind === 'asr' ? '语音模型' : '总结模型'} ${ordinal}`
}
