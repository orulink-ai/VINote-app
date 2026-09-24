import React, { useCallback, useEffect, useState } from 'react'
import { Text, Button, YStack, Card } from 'tamagui'
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
  const load = useCallback(async () => {
    setBusy(true); setError(''); onReady(false)
    try {
      const [list, selected] = await Promise.all([loadModels(), loadSelection()])
      setModels(list); setAsr(selected.asr_model); setLlm(selected.llm_model)
      const valid = (['asr', 'llm'] as const).every(kind => list.some(m => m.id === selected[`${kind}_model`] && m.modelType === kind && m.runtimeStatus === 'available'))
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
  if (!editing) return <Card style={styles.card}><Text style={styles.noteTitle}>云端处理</Text><Text style={styles.subtitle}>语音转写 · {asr}</Text><Text style={styles.subtitle}>会议纪要 · {llm}</Text><PrimaryButton secondary title="更换模型" disabled={disabled || busy} onPress={() => setEditing(true)} /></Card>
  return <Card style={styles.card}>
    <Text style={styles.noteTitle}>云端处理模型</Text>
    <Text style={styles.subtitle}>选择语音转写与纪要模型，保存后用于本次会议。</Text>
    {(['asr', 'llm'] as const).map(kind => <YStack key={kind} style={{ gap: 8 }}>
      <Text style={styles.label}>{kind === 'asr' ? '语音转写' : '会议纪要'}</Text>
      {models.filter(m => m.modelType === kind).map(m => {
        const selected = (kind === 'asr' ? asr : llm) === m.id
        const unavailable = m.runtimeStatus !== 'available'
        return <Button height="auto" flexDirection="column" alignItems="flex-start" key={m.id} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: unavailable || disabled }} disabled={disabled || busy || unavailable} onPress={() => { kind === 'asr' ? setAsr(m.id) : setLlm(m.id); onReady(false) }} style={{ padding: 12, borderWidth: 1, borderColor: selected ? colors.primary : colors.line, borderRadius: 12, backgroundColor: selected ? colors.primarySoft : colors.card, opacity: unavailable ? 0.45 : 1 }}><Text style={styles.label}>{selected ? '●  ' : '○  '}{m.id}</Text>{unavailable && <Text style={styles.subtitle}>当前不可用</Text>}</Button>
      })}
      {!busy && !error && !models.some(m => m.modelType === kind) && <Text style={styles.subtitle}>暂无部署模型</Text>}
    </YStack>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    <PrimaryButton title="确认模型" disabled={disabled || busy || !asr || !llm} loading={busy} onPress={save} />
    <PrimaryButton title="刷新模型列表" secondary disabled={disabled || busy} onPress={load} />
  </Card>
}
