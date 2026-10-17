import React, { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from './AppText'
import { PrimaryButton } from './PrimaryButton'
import { colors, styles } from '../design-system/theme'
import { loadModels, type CloudModel } from '../lib/models'
import { modelEligible } from '../lib/modelEligibility'
import { modelDisplay } from '../lib/modelDisplay'
import { identityEpoch } from '../lib/sessionIdentity'
import { prepareRecordingSummary, type PreparedRecordingSummary, type SummaryRecoveryConfirmation } from '../features/recording/recordingSummaryRecovery'

/** Local evidence review followed by a task-only LLM selection. No preference writes. */
export function RecordingSummaryRecovery({ recordId, disabled, onConfirm, onCancel }: {
  recordId: string; disabled: boolean; onConfirm: (value: SummaryRecoveryConfirmation) => void; onCancel: () => void
}) {
  const [prepared, setPrepared] = useState<PreparedRecordingSummary>()
  const [models, setModels] = useState<CloudModel[]>([])
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const confirmed = useRef(false)
  useEffect(() => {
    let active = true
    setPrepared(undefined); setModels([]); setModel(''); setError(''); setLoading(true); confirmed.current = false
    void (async () => {
      const value = await prepareRecordingSummary(recordId)
      if (!active || identityEpoch() !== value.epoch) return
      const list = await loadModels(true)
      if (!active || identityEpoch() !== value.epoch) return
      setPrepared(value); setModels(list.filter(entry => entry.modelType === 'llm'))
    })().catch(() => { if (active) setError('完整结果或总结模型尚未核验，请返回后重新读取；不会重新转写或分析。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [recordId])
  return <View style={{ gap: 12 }}>
    <Text style={styles.subtitle}>{loading ? '正在核对原录音、完整转写与说话人结果…' : prepared ? '完整转写与说话人结果已核验。此次只生成新版纪要，原纪要保留。' : '尚不能确认完整结果。'}</Text>
    <Text style={styles.label}>选择本次总结模型</Text>
    {models.map((entry, index) => <Pressable key={entry.id} accessibilityRole="radio"
      accessibilityState={{ checked: model === entry.id, disabled: disabled || !modelEligible(entry) }}
      disabled={disabled || !modelEligible(entry)} onPress={() => setModel(entry.id)}
      style={{ minHeight: 48, justifyContent: 'center', padding: 12, borderWidth: 1, borderColor: colors.line,
        backgroundColor: model === entry.id ? colors.primarySoft : colors.card }}>
      <Text style={styles.label}>{model === entry.id ? '● ' : '○ '}{modelDisplay(entry, 'llm', index + 1)}{!modelEligible(entry) ? ' · 当前不可用' : ''}</Text>
    </Pressable>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    <Text style={styles.subtitle}>不更改语音模型或默认模型。确认后会请求所选总结服务，可能产生费用；若上次总结结果未确认，本次也是一次明确的新请求。</Text>
    <PrimaryButton title="确认模型，仅生成纪要" style={{ minHeight: 48 }} disabled={disabled || loading || !prepared || !model}
      onPress={() => {
        if (disabled || loading || !prepared || !model || confirmed.current || identityEpoch() !== prepared.epoch) return
        confirmed.current = true
        onConfirm({ owner: prepared.owner, epoch: prepared.epoch, recordId, evidenceKey: prepared.evidenceKey, confirmed: true, llmModel: model })
      }} />
    <PrimaryButton secondary title="取消" style={{ minHeight: 48 }} disabled={disabled} onPress={onCancel} />
  </View>
}
