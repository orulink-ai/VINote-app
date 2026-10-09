import React, { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Text, View } from 'react-native'
import { Field } from './Field'
import { PrimaryButton } from './PrimaryButton'
import { colors, styles } from '../design-system/theme'

export function RenameDialog({ title, onSave, onClose }: { title: string; onSave: (value: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (busy || !value.trim()) return
    setBusy(true); setError('')
    try { await onSave(value.trim()); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试') }
    finally { setBusy(false) }
  }
  return <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose() }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#00000066' }}>
        <View style={styles.card}>
          <Text style={styles.noteTitle}>修改名称</Text>
          <Field label="会议名称" value={value} onChangeText={setValue} maxLength={120} editable={!busy} autoFocus returnKeyType="done" onSubmitEditing={save} />
          {error ? <Text style={{ color: colors.danger }} accessibilityRole="alert">{error}</Text> : null}
          <PrimaryButton title="保存名称" loading={busy} disabled={busy || !value.trim()} onPress={save} />
          <PrimaryButton secondary title="取消" disabled={busy} onPress={onClose} />
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}
