import { recordedAudioUsage } from '../lib/recordedAudioPolicy'
import { modelEligible, modelEligibility } from '../lib/modelEligibility'
import { modelDisplay } from '../lib/modelDisplay'
import { Text } from './AppText'
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { CloudModel, loadModels, loadSelection, saveSelection } from '../lib/models'
import { styles, colors } from '../design-system/theme'
import { PrimaryButton } from './PrimaryButton'

export function CloudModelPicker({ disabled, onReady }: { disabled: boolean; onReady: (ready: boolean) => void }) {
  const [models, setModels] = useState<CloudModel[]>([])
  const [asr, setAsr] = useState('')
  const [llm, setLlm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(true)
  const modelName = (id: string, kind: 'asr' | 'llm', ordinal?: number) => modelDisplay(models.find(value => value.id === id && value.modelType === kind), kind, ordinal)
  const load = useCallback(async (forceRefresh = false) => {
    setBusy(true); setError(''); onReady(false)
    try {
      const [list, selected] = await Promise.all([loadModels(forceRefresh), loadSelection()])
      setModels(list); setAsr(selected.asr_model); setLlm(selected.llm_model)
      const valid = (['asr', 'llm'] as const).every(kind => list.some(m => m.id === (kind === 'asr' ? selected.asr_model : selected.llm_model) && m.modelType === kind && modelEligible(m)))
      onReady(valid); setEditing(!valid)
    } catch (e) { setError(e instanceof Error ? e.message : '无法加载模型') }
    finally { setBusy(false) }
  }, [onReady])
  useEffect(() => { void load() }, [load])
  const save = async () => {
    setBusy(true); setError('')
    try { await saveSelection({ asr_model: asr, llm_model: llm }); onReady(true); setEditing(false) }
    catch (e) { onReady(false); setError(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }
  if (!editing) return <View style={{ gap: 12 }}><Text style={styles.noteTitle}>处理模型</Text><Text style={styles.subtitle}>语音转写 · {modelName(asr, 'asr')}</Text><Text style={styles.subtitle}>会议纪要 · {modelName(llm, 'llm')}</Text><Text style={styles.subtitle}>{recordedAudioUsage(models.find(m => m.id === asr && m.modelType === 'asr'))}</Text>{models.some(m => m.id === (m.modelType === 'asr' ? asr : llm) && modelEligibility(m) === 'retryable') && <Text style={styles.subtitle}>服务上次检查暂不可用，可尝试当前选择；尚未确认服务恢复。</Text>}<PrimaryButton tertiary title="更换模型" disabled={disabled || busy} onPress={() => setEditing(true)} /></View>
  return <View style={{ gap: 16 }}>
    <Text style={styles.noteTitle}>云端处理模型</Text>
    <Text style={styles.subtitle}>选择语音转写与纪要模型，保存后用于本次会议。</Text>
    {(['asr', 'llm'] as const).map(kind => <View key={kind} style={{ gap: 8 }}>
      <Text style={styles.label}>{kind === 'asr' ? '语音转写' : '会议纪要'}</Text>
      {(kind === 'asr' ? asr : llm) && !models.some(m => m.modelType === kind && m.id === (kind === 'asr' ? asr : llm)) && <Text style={styles.subtitle}>原选择：{modelName(kind === 'asr' ? asr : llm, kind)} · 暂不可用，已保留</Text>}{models.filter(m => m.modelType === kind).map((m, index) => {
        const selected = (kind === 'asr' ? asr : llm) === m.id
        const unavailable = !modelEligible(m)
        return <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: unavailable || disabled || busy }}
          disabled={disabled || busy || unavailable} onPress={() => { kind === 'asr' ? setAsr(m.id) : setLlm(m.id); onReady(false) }}
          style={{ minHeight: 48, paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: selected ? colors.primarySoft : colors.card, opacity: unavailable ? 0.45 : 1 }}>
          <Text style={styles.label}>{selected ? '●  ' : '○  '}{modelName(m.id, kind, index + 1)}</Text>{kind === 'asr' && <Text style={styles.subtitle}>{recordedAudioUsage(m)}</Text>}{unavailable && <Text style={styles.subtitle}>当前不可用，原选择保留</Text>}{modelEligibility(m) === 'retryable' && <Text style={styles.subtitle}>服务上次检查暂不可用，可尝试选择</Text>}
        </Pressable>
      })}
      {!busy && !error && !models.some(m => m.modelType === kind) && <Text style={styles.subtitle}>暂无部署模型</Text>}
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    <PrimaryButton title="确认模型" disabled={disabled || busy || !asr || !llm} loading={busy} onPress={save} />
    <PrimaryButton title="刷新模型列表" secondary disabled={disabled || busy} onPress={() => load(true)} />
  </View>
}
