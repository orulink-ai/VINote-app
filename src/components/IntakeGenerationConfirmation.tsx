import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from './AppText'
import { PrimaryButton } from './PrimaryButton'
import { loadModels, loadSelection, type CloudModel, type ModelSelection } from '../lib/models'
import { modelEligible } from '../lib/modelEligibility'
import { modelDisplay } from '../lib/modelDisplay'
import { identityEpoch, subscribeIdentity } from '../lib/sessionIdentity'
import { readAccountId } from '../lib/storage'
import { colors, styles } from '../design-system/theme'

/** Task-only choice; no preferences writes and no inference until confirmation. */
export function IntakeGenerationConfirmation({ owner, media, disabled, onConfirm, onCancel }: {
  owner: string; media: boolean; disabled: boolean; onConfirm: (models: ModelSelection) => void | Promise<void>; onCancel: () => void
}) {
  const [models, setModels] = useState<CloudModel[]>([])
  const [selection, setSelection] = useState<ModelSelection>({ asr_model: '', llm_model: '' })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const epoch = useRef(identityEpoch()), confirmed = useRef(false), sequence = useRef(0), mounted = useRef(true)
  const kinds: ('asr' | 'llm')[] = media ? ['asr', 'llm'] : ['llm']
  const eligible = kinds.every(kind => models.some(m => m.modelType === kind && m.id === selection[`${kind}_model`] && modelEligible(m)))
  const load = useCallback(async () => {
    const run = ++sequence.current, identity = identityEpoch()
    epoch.current = identity; confirmed.current = false
    setModels([]); setSelection({ asr_model: '', llm_model: '' }); setLoading(true); setSubmitting(false); setError('')
    const current = () => mounted.current && sequence.current === run && identityEpoch() === identity
    try {
      if (await readAccountId() !== owner || !current()) throw new Error('账号已变化')
      const [catalog, defaults] = await Promise.all([loadModels(true), loadSelection()])
      if (!current() || await readAccountId() !== owner || !current()) return
      setModels(catalog); setSelection({ ...defaults })
    } catch { if (current()) setError('模型暂不能核验，请重新读取模型；未开始生成。') }
    finally { if (current()) setLoading(false) }
  }, [owner])
  useEffect(() => {
    mounted.current = true; void load()
    return () => { mounted.current = false; sequence.current++ }
  }, [load])
  useEffect(() => subscribeIdentity(() => {
    sequence.current++; confirmed.current = false; setModels([]); setSelection({ asr_model: '', llm_model: '' }); setLoading(false); setSubmitting(false)
    setError('账号已变化，请重新核对本次模型。')
  }), [])
  const confirm = async () => {
    if (disabled || submitting || loading || !eligible || confirmed.current || identityEpoch() !== epoch.current) return
    confirmed.current = true; setSubmitting(true); setError('')
    const run = sequence.current
    try {
      if (await readAccountId() !== owner || identityEpoch() !== epoch.current || run !== sequence.current || !mounted.current) throw new Error('账号已变化')
      await onConfirm({ ...selection })
    } catch {
      if (mounted.current && run === sequence.current) { confirmed.current = false; setError('提交未能开始或确认，请核对原操作；不会自动重试。') }
    } finally { if (mounted.current && run === sequence.current) setSubmitting(false) }
  }
  return <View style={{ gap: 12 }}>
    <Text style={styles.subtitle}>{loading ? '正在核对本次处理模型…' : media ? '本次使用以下模型转写音视频并整理笔记，原文件保留。' : '本次使用以下模型整理完整来源，不调用语音转写。'}</Text>
    {kinds.map(kind => <View key={kind} style={{ gap: 6 }}>
      <Text style={styles.label}>{kind === 'asr' ? '语音转写' : '内容总结'}</Text>
      {models.filter(m => m.modelType === kind).map((m, index) => <Pressable key={m.id} accessibilityRole="radio"
        accessibilityState={{ checked: selection[`${kind}_model`] === m.id, disabled: disabled || submitting || !modelEligible(m) }}
        disabled={disabled || submitting || !modelEligible(m)} onPress={() => setSelection(previous => ({ ...previous, [`${kind}_model`]: m.id }))}
        style={{ minHeight: 48, justifyContent: 'center', padding: 12, backgroundColor: selection[`${kind}_model`] === m.id ? colors.primarySoft : colors.card }}>
        <Text style={styles.label}>{selection[`${kind}_model`] === m.id ? '● ' : '○ '}{modelDisplay(m, kind, index + 1)}{!modelEligible(m) ? ' · 当前不可用' : ''}</Text>
      </Pressable>)}
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    <Text style={styles.subtitle}>仅用于本次处理，不改变默认模型。确认后请求所选服务；未确认结果不会自动重发。</Text>
    {(disabled || submitting) && <Text accessibilityRole="alert" style={styles.subtitle}>正在登记并启动本次处理，请稍候…</Text>}
    <PrimaryButton title="确认模型并开始生成" loading={disabled || submitting} disabled={disabled || submitting || loading || !eligible} onPress={() => void confirm()} />
    <PrimaryButton secondary title="重新读取模型" disabled={disabled || submitting || loading || confirmed.current} onPress={() => void load()} />
    <PrimaryButton secondary title="取消" disabled={disabled || submitting} onPress={onCancel} />
  </View>
}
