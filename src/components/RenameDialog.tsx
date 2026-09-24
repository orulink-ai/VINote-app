import React, { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform } from 'react-native'
import { Card, Text, YStack } from 'tamagui'
import { Field } from './Field'
import { PrimaryButton } from './PrimaryButton'

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
      <YStack flex={1} justifyContent="center" padding="$5" backgroundColor="#00000066">
        <Card padding="$5" gap="$4" backgroundColor="white" borderRadius="$4">
          <Text fontSize={20} fontWeight="600">修改名称</Text>
          <Field label="会议名称" value={value} onChangeText={setValue} maxLength={120} editable={!busy} autoFocus returnKeyType="done" onSubmitEditing={save} />
          {error ? <Text color="#B42318" accessibilityRole="alert">{error}</Text> : null}
          <PrimaryButton title="保存名称" loading={busy} disabled={busy || !value.trim()} onPress={save} />
          <PrimaryButton secondary title="取消" disabled={busy} onPress={onClose} />
        </Card>
      </YStack>
    </KeyboardAvoidingView>
  </Modal>
}
