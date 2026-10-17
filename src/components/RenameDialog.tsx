import { Text } from './AppText'
import React, { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, View } from 'react-native'
import { Field } from './Field'
import { PrimaryButton } from './PrimaryButton'
import { colors, styles } from '../design-system/theme'

type RenameProps = { title: string; onSave: (value: string) => Promise<void>; onClose: () => void; label?: string; maxLength?: number; onBusyChange?: (busy: boolean) => void }

export function RenameForm({ title, onSave, onClose, label = '会议名称', maxLength = 120, onBusyChange }: RenameProps) {
  const [value, setValue] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (busy || !value.trim()) return
    setBusy(true); setError(''); onBusyChange?.(true)
    try { await onSave(value.trim()); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试') }
    finally { setBusy(false); onBusyChange?.(false) }
  }
  return <View style={{ gap: 16 }}>
    <Field label={label} value={value} onChangeText={setValue} maxLength={maxLength} editable={!busy} autoFocus returnKeyType="done" onSubmitEditing={save} />
    {error ? <Text style={{ color: colors.danger }} accessibilityRole="alert">{error}</Text> : null}
    <PrimaryButton title="保存名称" loading={busy} disabled={busy || !value.trim()} onPress={save} />
    <PrimaryButton secondary title="取消" disabled={busy} onPress={onClose} />
  </View>
}

export function RenameDialog(props: RenameProps) {
  const [busy, setBusy] = useState(false)
  return <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) props.onClose() }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#00000066' }}>
        <View style={styles.card}>
          <Text style={styles.noteTitle}>修改名称</Text>
          <RenameForm {...props} onBusyChange={setBusy} />
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}
