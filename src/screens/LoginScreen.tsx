import React, { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native'
import { Field } from '../components/Field'
import { PrimaryButton } from '../components/PrimaryButton'
import { signIn } from '../lib/auth'
import { styles } from '../design-system/theme'

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    if (!email || password.length < 6) return Alert.alert('信息不完整', '请输入邮箱和至少 6 位密码。')
    setLoading(true)
    try { await signIn(email, password); onAuthenticated() }
    catch (error) { Alert.alert('登录失败', error instanceof Error ? error.message : '请稍后重试') }
    finally { setLoading(false) }
  }
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={[styles.content, styles.loginContent]}><Text style={styles.title}>VINote</Text><Text style={styles.subtitle}>把会议语音变成清晰、可回看的会议纪要。</Text><Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" /><Field label="密码" value={password} onChangeText={setPassword} secureTextEntry placeholder="至少 6 位" /><PrimaryButton title="登录" loading={loading} onPress={submit} /><Text style={styles.subtitle}>请使用桌面端或 VINote 云端已有账号登录。</Text></View></KeyboardAvoidingView>
}
