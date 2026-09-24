import React, { useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native'
import { Field } from '../components/Field'
import { PrimaryButton } from '../components/PrimaryButton'
import { requestPasswordReset, resetPassword } from '../lib/auth'
import { styles } from '../design-system/theme'

export function PasswordResetScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  const send = async () => {
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return Alert.alert('邮箱无效', '请输入注册时使用的邮箱。')
    setLoading(true)
    try {
      const result = await requestPasswordReset(address)
      setEmail(address)
      setSent(true)
      setCooldown(60)
      Alert.alert('查收邮件', result.message)
    } catch (error) { Alert.alert('发送失败', error instanceof Error ? error.message : '请稍后重试') }
    finally { setLoading(false) }
  }
  const submit = async () => {
    if (!/^[0-9]{6,10}$/.test(code)) return Alert.alert('验证码无效', '请输入邮件中的验证码。')
    if (password.length < 6 || password.length > 128) return Alert.alert('密码不符合要求', '请输入 6 至 128 位新密码。')
    if (password !== confirmation) return Alert.alert('密码不一致', '请检查两次输入的新密码。')
    setLoading(true)
    try {
      await resetPassword(email, code, password)
      Alert.alert('密码已重置', '请使用新密码登录，手机与桌面端使用同一密码。')
      onBack()
    } catch (error) { Alert.alert('重置失败', error instanceof Error ? error.message : '请稍后重试') }
    finally { setLoading(false) }
  }
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, styles.loginContent]}>
      <Text style={styles.title}>重置密码</Text>
      <Text style={styles.subtitle}>通过注册邮箱验证身份，设置新的 VINote 账号密码。</Text>
      <Field label="邮箱" value={email} onChangeText={setEmail} editable={!sent && !loading} keyboardType="email-address" autoCorrect={false} placeholder="you@example.com" />
      {sent && <>
        <Field label="邮箱验证码" value={code} onChangeText={setCode} editable={!loading} keyboardType="number-pad" maxLength={10} />
        <Field label="新密码" value={password} onChangeText={setPassword} editable={!loading} secureTextEntry maxLength={128} />
        <Field label="确认新密码" value={confirmation} onChangeText={setConfirmation} editable={!loading} secureTextEntry maxLength={128} />
        <PrimaryButton title="确认重置密码" loading={loading} disabled={loading} onPress={submit} />
      </>}
      <PrimaryButton title={sent ? (cooldown ? cooldown + ' 秒后可重新发送' : '重新发送验证码') : '发送重置验证码'} loading={loading && !sent} disabled={loading || cooldown > 0} onPress={send} />
      <PrimaryButton title="返回登录" disabled={loading} onPress={onBack} />
    </ScrollView>
  </KeyboardAvoidingView>
}
