import { feishuVerificationUnavailable, feishuVerificationMessage } from '../lib/feishuConnectionState'
import { Text } from '../components/AppText'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Image,
  Alert,
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from 'react-native'
import { feishuApi, type FeishuGroup, type FeishuStatus, type FeishuAuthorization } from '../lib/feishu'
import { SettingsCheckbox } from '../components/SettingsCheckbox'
import { ScreenHeader } from '../components/ScreenHeader'
import { WorkspaceIcon } from '../components/WorkspaceIcon'
import { BottomActionSheet } from '../components/BottomActionSheet'
import { PrimaryButton } from '../components/PrimaryButton'
import { colors, styles } from '../design-system/theme'
import { FeishuApplicationSetup } from '../components/FeishuApplicationSetup'
import { FeishuDestinationPicker } from '../components/FeishuDestinationPicker'

export function FeishuSettingsScreen({ onBack }: {
  onBack: () => void
}) {
  const [value, setValue] = useState<FeishuStatus | null>(null)
  const verificationUnavailable = feishuVerificationUnavailable(value)
  const [groups, setGroups] = useState<FeishuGroup[]>([])
  const [groupPicker, setGroupPicker] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [authorization, setAuthorization] = useState<FeishuAuthorization | null>(null)
  const [authExpired, setAuthExpired] = useState(false)
  const load = async (preserveDraft = true) => {
    setBusy(true)
    setError('')
    setSaveFailed(false)
    try {
      const next = await feishuApi<FeishuStatus>('/status')
      setValue(current => dirty && preserveDraft && current ? { ...next, notify_self: current.notify_self, groups: current.groups, auto_publish: current.auto_publish, destination_config: current.destination_config, permission_policy: current.permission_policy } : next)
      if (!preserveDraft || !dirty) setDirty(false)
      setGroupError('')
      if (next.connected && !next.expired && !feishuVerificationUnavailable(next)) {
        try { setGroups(await feishuApi<FeishuGroup[]>('/groups')) }
        catch (cause) { setGroupError((cause as Error).message) }
        if (authUrl) {
          setAuthUrl('')
          setAuthorization(null)
          setMessage(dirty ? '已连接飞书，未保存修改仍需保存。' : '飞书连接已核验')
        }
      } else {
        setGroups([])
        if (authUrl) setMessage(feishuVerificationUnavailable(next) ? feishuVerificationMessage : next.expired ? '授权仍已过期，请继续授权后核验。' : '尚未完成连接，请继续授权后核验。')
      }
      return true
    } catch (cause) {
      if ((cause as { code?: string }).code === 'FEISHU_NOT_CONFIGURED') {
        setValue({ configured: false, connected: false, expired: false, name: '', notify_self: true, groups: [], auto_publish: false })
        return false
      }
      setError((cause as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!authorization) return
    const timer = setTimeout(() => setAuthExpired(true), Math.max(0, authorization.expires_at * 1000 - Date.now()))
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void loadRef.current() })
    return () => { clearTimeout(timer); listener.remove() }
  }, [authorization])
  const change = (patch: Partial<FeishuStatus>) => {
    setValue(current => (current ? { ...current, ...patch } : current))
    setDirty(true)
    setMessage('')
  }
  const leave = (destination: () => void) =>
    dirty
      ? Alert.alert('修改尚未保存', '离开会丢弃本次修改。', [
          { text: '继续编辑' },
          { text: '丢弃修改', onPress: destination },
        ])
      : destination()
  const back = () => leave(onBack)
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      back()
      return true
    })
    return () => handler.remove()
  }, [dirty, onBack])
  const disabled = verificationUnavailable || busy || !value?.connected || value?.expired
  const refreshGroups = async () => {
    setBusy(true)
    setGroupError('')
    try {
      setGroups(await feishuApi<FeishuGroup[]>('/groups'))
    } catch (cause) {
      setGroupError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader title="飞书" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {error ? (
          <View
            style={{
              gap: 12,
              paddingVertical: 22,
              borderBottomWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {error}
            </Text>
            <PrimaryButton
              secondary
              title="重新加载"
              disabled={busy}
              onPress={() => void load()}
            />
          </View>
        ) : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.subtitle}>
            {message}
          </Text>
        ) : null}
        {busy && !value ? <ActivityIndicator color={colors.ink} /> : null}
        {value && !value.configured ? <View style={styles.card}><Text style={styles.noteTitle} accessibilityRole="alert">授权服务尚未就绪</Text><Text style={styles.subtitle}>当前无法生成有效的授权链接，笔记和会议纪要仍可正常保存。尚缺：{(value.setup?.missing || ['application']).map(key => ({ application: 'VINote 企业应用', callback: '授权回调', organization: '公司绑定', documents: '云文档地址', encryption: '授权存储配置' } as Record<string, string>)[key] || '服务配置').join('、')}。</Text><PrimaryButton secondary title="重新检查接入" loading={busy} onPress={() => void load()} /></View> : null}
        <View
          style={styles.card}
        >
          <Text style={styles.noteTitle}>账号连接</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 36, height: 36, borderWidth: 1, borderColor: colors.line, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }}><Text style={styles.noteBody}>{value?.name?.slice(0, 1) || '飞'}</Text></View>
            <View style={{ flex: 1, gap: 3 }}><Text style={styles.noteBody}>{!value ? '连接状态尚未读取' : verificationUnavailable ? value.name || '飞书账号' : value.connected ? value.name : '连接你的公司飞书账号'}</Text><Text style={styles.subtitle} accessibilityLiveRegion="polite">{!value ? '读取中' : !value.configured ? '授权服务未就绪' : verificationUnavailable ? '连接暂时无法核验' : value.expired ? '需要重新授权' : value.connected ? '已连接' : authExpired ? '授权链接已过期' : authUrl ? '等待你授权' : '尚未连接'}</Text></View>
          </View>
          {value?.expired && !verificationUnavailable ? (
            <Text style={{ color: colors.danger }}>
              授权已过期，请重新连接后恢复交付。
            </Text>
          ) : null}
          <PrimaryButton
            style={{ alignSelf: 'flex-end', minHeight: 44, paddingHorizontal: 14 }}
            secondary={!!value?.connected}
            title={verificationUnavailable ? '重新核验飞书连接' : authExpired ? '重新生成授权' : value?.connected ? '重新连接飞书' : '连接飞书'}
            loading={busy}
            disabled={!value?.configured}
            onPress={async () => {
              if (verificationUnavailable) { await load(); return }
              setBusy(true)
              setError('')
              setSaveFailed(false)
              try {
                const auth = await feishuApi<FeishuAuthorization>('/authorize', {
                  method: 'POST',
                })
                setAuthUrl(auth.url)
                setAuthorization(auth)
                setAuthExpired(false)
                await Linking.openURL(auth.url)
              } catch (cause) {
                setError((cause as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          />
          {verificationUnavailable && <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{feishuVerificationMessage}</Text>}
          {authUrl ? (
            <>
              {authorization?.qr_data_url && !authExpired ? <Image source={{ uri: authorization.qr_data_url }} style={{ width: 152, height: 152, alignSelf: 'center' }} accessibilityLabel="飞书授权二维码" /> : null}
              <Text style={styles.subtitle}>
                {authExpired ? '授权链接已过期，请重新生成。' : '扫码或在浏览器、飞书中完成授权后，回到这里核验。链接有效期 10 分钟。'}
              </Text>
              <PrimaryButton
                secondary
                title="继续授权"
                disabled={authExpired}
                onPress={() => {
                  void Linking.openURL(authUrl).catch(cause =>
                    setError(cause.message),
                  )
                }}
              />
              <PrimaryButton
                secondary
                title="我已完成授权"
                disabled={busy || authExpired}
                onPress={() => void load()}
              />
            </>
          ) : null}
          {value?.connected ? (
            <PrimaryButton
              tertiary
              style={{ alignSelf: 'flex-end', minHeight: 44, paddingHorizontal: 14 }}
              title="断开连接"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  '断开飞书？',
                  '停止后续交付，已创建文档继续保留。',
                  [
                    { text: '取消' },
                    {
                      text: '断开',
                      onPress: async () => {
                        setBusy(true)
                        try {
                          await feishuApi('/connection', { method: 'DELETE' })
                          await load(false)
                        } catch (cause) {
                          setError((cause as Error).message)
                        } finally {
                          setBusy(false)
                        }
                      },
                    },
                  ],
                )
              }
            />
          ) : null}
        </View>
        <View
          style={styles.card}
        >
          <FeishuDestinationPicker value={value?.destination_config || { kind: 'personal' }} disabled={!!disabled} onChange={destination_config => change({ destination_config, permission_policy: destination_config.kind === 'personal' ? 'private' : 'inherit' })} />
        </View>
        <View
          style={styles.card}
        >
          <Text style={styles.noteTitle}>机器人通知</Text>
          <SettingsCheckbox label="发给我本人" disabled={!!disabled} checked={value?.notify_self ?? true} onChange={checked => change({ notify_self: checked })} />
          <SettingsCheckbox label="发给指定群" disabled={!!disabled} checked={!!value?.groups.length} onChange={checked => checked ? setGroupPicker(true) : change({ groups: [] })} />
          <Pressable accessibilityRole="button" accessibilityLabel="选择通知群" disabled={!!disabled} onPress={() => setGroupPicker(true)} style={{ minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 7, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: disabled ? 0.45 : 1 }}>
            <Text style={[styles.noteBody, { flex: 1 }]} numberOfLines={1}>{value?.groups.length ? value.groups.map(id => groups.find(group => group.chat_id === id)?.name || '已选群').join('、') : '选择通知群'}</Text><WorkspaceIcon name="chevron" muted />
          </Pressable>
          <Text style={styles.subtitle}>
            仅显示你和机器人共同加入的群；交付时校验文档阅读权限。
          </Text>
          {groupError ? <PrimaryButton tertiary style={{ alignSelf: 'flex-start' }} title="刷新群列表" disabled={!!disabled} loading={busy} onPress={() => void refreshGroups()} /> : null}
          {groupError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{groupError}，已选群继续保留，请重试刷新。</Text> : null}
        </View>
        <View
          style={styles.card}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={styles.noteTitle}>自动交付新纪要</Text>
            <Switch
              accessibilityLabel="自动交付新纪要"
              disabled={!!disabled || !value?.capabilities?.background_delivery}
              value={value?.auto_publish ?? false}
              onValueChange={checked => change({ auto_publish: checked })}
            />
          </View>
          <Text style={styles.subtitle}>
            {!value || verificationUnavailable ? '后台交付能力尚未核验，请先重新读取连接状态。' : value.capabilities?.background_delivery ? '首次完成版本自动发布；之后修改需手动发布。' : '当前服务未启用持续后台交付，请从内容详情发布到飞书。'}
          </Text>
        </View>
        <FeishuApplicationSetup onChanged={() => void load(false)} />
      </ScrollView>
      <View
        style={{
          padding: 20,
          gap: 10,
          borderTopWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text accessibilityLiveRegion="polite" style={[styles.subtitle, { flex: 1 }]}>
          {saveFailed && dirty ? '保存失败，修改已保留，请重试保存。' : error && dirty ? '操作未完成，未保存修改仍保留。' : message || (dirty ? '有未保存修改' : '设置按 VINote 账号共享')}
        </Text>
        <PrimaryButton
          style={{ minHeight: 44, paddingHorizontal: 14 }}
          title={saveFailed && dirty ? '重试保存' : '保存设置'}
          loading={busy}
          disabled={!!disabled || !dirty}
          onPress={async () => {
            if (!value) return
            setBusy(true)
            setError('')
            setSaveFailed(false)
            try {
              setValue(
                await feishuApi<FeishuStatus>('/preferences', {
                  method: 'PUT',
                  body: JSON.stringify({
                    notify_self: value.notify_self,
                    groups: value.groups,
                    auto_publish: value.auto_publish,
                    destination_config: value.destination_config || { kind: 'personal' },
                    permission_policy: value.permission_policy || 'private',
                  }),
                }),
              )
              setDirty(false)
              setMessage('设置已保存')
            } catch (cause) {
              setSaveFailed(true)
              setError((cause as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        />
      </View>
      <BottomActionSheet
        visible={groupPicker}
        title="选择通知群"
        onClose={() => { if (!busy) setGroupPicker(false) }}
      >
        <TextInput
          accessibilityLabel="搜索群"
          placeholder="搜索机器人已加入的群"
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          editable={!disabled}
        />
        {groups
          .filter(group => group.name.toLowerCase().includes(query.trim().toLowerCase()))
          .map(group => (
            <Pressable
              key={group.chat_id}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: value?.groups.includes(group.chat_id),
                disabled: !!disabled,
              }}
              disabled={!!disabled}
              onPress={() =>
                change({
                  groups: value?.groups.includes(group.chat_id)
                    ? value.groups.filter(id => id !== group.chat_id)
                    : [...(value?.groups || []), group.chat_id],
                })
              }
              style={{
                minHeight: 48,
                flexDirection: 'row',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <Text style={styles.noteBody}>
                {value?.groups.includes(group.chat_id) ? '☑' : '□'} {group.name}
              </Text>
            </Pressable>
          ))}
        {groupError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{groupError}，已选群继续保留，请重试刷新。</Text> : null}
        {!groupError && !groups.filter(group => group.name.toLowerCase().includes(query.trim().toLowerCase())).length ? (
          <Text style={styles.subtitle}>
            {query
              ? '没有匹配的群，请调整关键词。'
              : '没有可用群。把机器人加入目标群后，刷新群列表。'}
          </Text>
        ) : null}
        <Text style={styles.subtitle}>
          可同时选择多个群，点完成后仍需保存设置。
        </Text>
        <PrimaryButton secondary title="刷新群列表" loading={busy} disabled={!!disabled} onPress={() => void refreshGroups()} />
        <PrimaryButton title="完成选择" disabled={busy} onPress={() => setGroupPicker(false)} />
      </BottomActionSheet>
    </View>
  )
}
