import React, { useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native'
import { Field } from '../components/Field'
import { PrimaryButton } from '../components/PrimaryButton'
import { getAuthConfig, requestRegistration, signIn, signUp, verifyRegistration } from '../lib/auth'
import { styles } from '../design-system/theme'
import { PasswordResetScreen } from './PasswordResetScreen'

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState('')
  const [register, setRegister] = useState(false)
  const [reset, setReset] = useState(false)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  const submit = async (resend = false) => {
    const address = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || password.length < 6) {
      return Alert.alert('信息不完整', '请输入有效邮箱和至少 6 位密码。')
    }
    if (register && password !== confirmation) return Alert.alert('密码不一致', '请检查两次输入的密码。')
    if (sent && !resend && !/^[0-9]{6,10}$/.test(code)) return Alert.alert('验证码不完整', '请输入邮件中的验证码。')
    setLoading(true)
    try {
      if (!register) await signIn(address, password)
      else if (sent && !resend) await verifyRegistration(address, code)
      else {
        const config = await getAuthConfig()
        if (config.email_code) {
          const result = await requestRegistration(address, password)
          setEmail(address)
          setSent(true)
          setCooldown(60)
          Alert.alert('验证邮箱', result.message)
          return
        }
        await signUp(address, password)
      }
      onAuthenticated()
    } catch (error) {
      Alert.alert(register ? '注册未完成' : '登录失败', error instanceof Error ? error.message : '请稍后重试')
    } finally { setLoading(false) }
  }
  const switchMode = () => {
    setRegister(!register)
    setEmail('')
    setPassword('')
    setConfirmation('')
    setCode('')
    setSent(false)
  }
  if (reset) return <PasswordResetScreen onBack={() => setReset(false)} />
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, styles.loginContent]}>
      <Text style={styles.title}>{register ? '注册 VINote' : 'VINote'}</Text>
      <Text style={styles.subtitle}>手机与桌面端共用一个 VINote 账号，可直接在手机注册。</Text>
      <Field label="邮箱" value={email} onChangeText={setEmail} editable={!sent && !loading} keyboardType="email-address" autoCorrect={false} placeholder="you@example.com" />
      <Field label="密码" value={password} onChangeText={setPassword} editable={!sent && !loading} secureTextEntry placeholder="至少 6 位" />
      {register && <Field label="确认密码" value={confirmation} onChangeText={setConfirmation} editable={!sent && !loading} secureTextEntry placeholder="再次输入密码" />}
      {sent && <><Text style={styles.subtitle}>请查收邮箱验证码。邮箱和密码已锁定；需要修改时请返回登录后重新注册。</Text><Field label="邮箱验证码" value={code} onChangeText={setCode} editable={!loading} keyboardType="number-pad" maxLength={10} /></>}
      <PrimaryButton title={register ? (sent ? '验证并登录' : '注册账号') : '登录'} loading={loading} disabled={loading} onPress={() => submit()} />
      {sent && <PrimaryButton title={cooldown ? cooldown + ' 秒后可重新发送' : '重新发送验证码'} disabled={loading || cooldown > 0} onPress={() => submit(true)} />}
      <PrimaryButton title={register ? '已有账号，返回登录' : '没有账号？注册'} disabled={loading} onPress={switchMode} />
      {!register && <PrimaryButton title="忘记密码？" disabled={loading} onPress={() => { setPassword(''); setReset(true) }} />}
    </ScrollView>
  </KeyboardAvoidingView>
}
