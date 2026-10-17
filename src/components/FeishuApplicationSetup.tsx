import React, { useEffect, useState } from 'react'
import { Alert, Linking, TextInput, View } from 'react-native'
import { Text } from './AppText'
import { PrimaryButton } from './PrimaryButton'
import { feishuApi } from '../lib/feishu'
import { colors, styles } from '../design-system/theme'

type Application = { custom: boolean; app_id: string; redirect_uri: string; tenant_key: string; document_domain: string }
export function FeishuApplicationSetup({ onChanged }: { onChanged: () => void }) {
  const [app, setApp] = useState<Application | null>(null), [secret, setSecret] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = async () => { setBusy(true); setError(''); try { setApp(await feishuApi<Application>('/application')) } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) } }
  useEffect(() => { void load() }, [])
  const save = async () => {
    if (!app) return
    setBusy(true); setError('')
    try { setApp(await feishuApi<Application>('/application', { method: 'PUT', body: JSON.stringify({ app_id: app.app_id, app_secret: secret, tenant_key: app.tenant_key, document_domain: app.document_domain }) })); setSecret(''); setEditing(false); onChanged() }
    catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  if (!advanced) return <View style={[styles.card, { gap: 8 }]}><Text style={styles.noteTitle}>应用管理</Text><Text style={styles.subtitle}>配置、更换或清理应用凭证；日常使用无需调整。</Text><PrimaryButton tertiary title="管理应用" onPress={() => setAdvanced(true)} /></View>
  return <View style={[styles.card, { gap: 12 }]}><PrimaryButton tertiary title="收起应用管理" onPress={() => setAdvanced(false)} /><Text style={styles.noteTitle}>选择接入方式</Text><Text style={styles.subtitle}>公司已接入可直接授权；也可以配置自己的企业应用，再授权飞书账号。新应用需在飞书审核发布。</Text>
    {!!error && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><PrimaryButton secondary title="重新读取配置" disabled={busy} onPress={() => void load()} /></>}
    <PrimaryButton secondary title={editing ? '收起应用配置' : app?.custom ? '更换应用凭证' : '选择已有企业应用'} disabled={busy || !app} onPress={() => setEditing(!editing)} />
    <PrimaryButton tertiary title="打开飞书应用后台" onPress={() => void Linking.openURL('https://open.feishu.cn/app').catch(cause => setError(cause.message))} />
    {editing && app && <><Text selectable style={styles.subtitle}>飞书后台回调地址：{app.redirect_uri || '服务端尚未配置'}。启用机器人及文档、消息权限，发布给本公司成员。</Text>
      {(['app_id', 'tenant_key', 'document_domain'] as const).map(key => <View key={key} style={{ gap: 6 }}><Text style={styles.subtitle}>{({ app_id: 'App ID', tenant_key: '公司 Tenant Key', document_domain: '云文档域名' })[key]}</Text><TextInput accessibilityLabel={key} autoCapitalize="none" autoCorrect={false} editable={!busy} value={app[key]} onChangeText={text => setApp({ ...app, [key]: text.trim() })} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, color: colors.ink }} /></View>)}
      <Text style={styles.subtitle}>App Secret</Text><TextInput accessibilityLabel="App Secret" secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} value={secret} onChangeText={setSecret} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, color: colors.ink }} />
      <Text style={styles.subtitle}>通过 HTTPS 提交，服务端加密保存。替换后需重新授权；原文档保留。</Text><PrimaryButton title="验证并保存应用" loading={busy} disabled={!secret || !app.app_id || !app.tenant_key || !app.document_domain} onPress={() => void save()} /></>}
    {app?.custom && <PrimaryButton tertiary title="清理应用凭证" disabled={busy} onPress={() => Alert.alert('清理应用凭证？', '删除保存的密钥和授权，停止后续交付；已有飞书文档保留。', [{ text: '取消', style: 'cancel' }, { text: '清理', style: 'destructive', onPress: async () => { setBusy(true); try { await feishuApi('/application', { method: 'DELETE' }); setSecret(''); setEditing(false); await load(); onChanged() } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) } } }])} />}
  </View>
}
