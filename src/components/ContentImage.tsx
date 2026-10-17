import React, { useEffect, useRef, useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import FS from 'react-native-fs'
import { Text } from './AppText'
import { generationBaseUrl, integrationBaseUrl, integrationJson, operationId } from '../lib/integration'
import { accessToken } from '../lib/supabase'
import { readAccountId, sessionRevision } from '../lib/storage'
import { assertRemoteScope, captureRemoteScope } from '../lib/sessionGate'
import { useSessionGate } from '../lib/useSessionGate'
import { styles } from '../design-system/theme'

export type RemoteImagePolicy = 'allow' | 'confirm'

function deviceImagePath(source: string): string | undefined {
  const path = source.startsWith('/') ? source : generationBaseUrl && source.startsWith(generationBaseUrl + '/') ? source.slice(generationBaseUrl.length) : ''
  const match = /^\/api\/task\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/artifacts\/(?:screenshots|media)\/([a-z0-9_.-]{1,200})\.(png|jpe?g|webp)$/i.exec(path)
  if (match && !match[1].includes('..')) return path
}

// Only the fixed device generation API receives this account's authorization.
// The native Image gets an ephemeral local file, never a remote Bearer header.
function DeviceContentImage({ path, alt, revision }: { path: string; alt?: string; revision: number }) {
  const gate = useSessionGate()
  const [uri, setUri] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, target = '', jobId: number | undefined
    const remove = async () => { if (target) await FS.unlink(target).catch(() => {}) }
    const load = async () => {
      let retained = false
      try {
        setUri(''); setError('')
        if (!generationBaseUrl) throw new Error('当前内容处理服务尚未配置')
        const scope = captureRemoteScope()
        const owner = await readAccountId()
        if (!owner) throw new Error('请登录后读取截图')
        const guard = async () => {
          assertRemoteScope(scope)
          if (!active || await readAccountId() !== owner || !active || sessionRevision() !== revision) throw new Error('账号或正文已切换，截图读取已停止')
        }
        await guard()
        const token = await accessToken(false, owner)
        await guard()
        const directory = `${FS.CachesDirectoryPath}/vinote-content/${encodeURIComponent(owner)}`
        target = `${directory}/${operationId()}.image`
        await FS.mkdir(directory)
        await guard()
        const limit = 5 * 1024 * 1024
        let rejected = false, imageType = false
        const download = FS.downloadFile({
          fromUrl: generationBaseUrl + path, toFile: target, headers: { Authorization: `Bearer ${token}` },
          connectionTimeout: 10000, readTimeout: 20000,
          begin: response => {
            const type = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
            imageType = typeof type === 'string' && /^image\/(png|jpeg|webp)(?:;|$)/i.test(type)
            if (!imageType || response.contentLength > limit) { rejected = true; FS.stopDownload(response.jobId) }
          },
          progressInterval: 100,
          progress: response => { if (response.bytesWritten > limit) { rejected = true; FS.stopDownload(response.jobId) } },
        })
        jobId = download.jobId
        const result = await download.promise
        await guard()
        if (rejected || !imageType || result.statusCode !== 200 || result.bytesWritten <= 0 || result.bytesWritten > limit) throw new Error('截图读取失败，请重试')
        retained = true; setUri(`file://${target}`)
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '截图读取失败，请重试')
      } finally { if (!retained || !active) await remove() }
    }
    void load()
    return () => { active = false; if (jobId !== undefined) FS.stopDownload(jobId); void remove() }
  }, [path, attempt, revision, gate])
  if (gate.mode !== 'verified') return <Text style={styles.subtitle}>{alt || '内容截图'}：账号待核验，私有截图暂不可读取。</Text>
  if (error) return <View style={{ gap: 8, paddingVertical: 12 }}><Text accessibilityRole="alert" style={styles.subtitle}>{alt || '内容截图'}：{error}</Text><Pressable accessibilityRole="button" accessibilityLabel={`重试读取截图：${alt || '内容截图'}`} onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={styles.link}>重试读取截图</Text></Pressable></View>
  if (!uri) return <Text style={styles.subtitle}>正在读取{alt || '内容截图'}…</Text>
  return <Image accessibilityLabel={alt || '内容截图'} source={{ uri }} resizeMode="contain" style={{ width: '100%', height: 220, marginVertical: 12 }} onError={() => setError('截图暂不可用，请重试')} />
}

function remoteImageUrl(source: string): URL | undefined {
  if (!/^https?:\/\//i.test(source) || /[\s\\\u0000-\u001f\u007f]/.test(source)) return
  const authority = /^https?:\/\/([^/?#]+)/i.exec(source)?.[1]
  // React Native's URL implementation is narrower than the browser's. Reject
  // ambiguous authorities instead of displaying a misleading hostname.
  const host = authority && /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(authority)
  if (!host || (host[2] && Number(host[2]) > 65535)) return
  try {
    const url = new URL(source)
    if (!url.hostname || url.username || url.password) return
    return url
  } catch { return }
}

function ConfirmedRemoteImage({ source, alt, revision }: { source: string; alt?: string; revision: number }) {
  const url = remoteImageUrl(source), description = alt || '图片未提供说明'
  const [owner, setOwner] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>('idle')
  const [attempt, setAttempt] = useState(0)
  const active = useRef(true), checking = useRef(false), sequence = useRef(0)
  useEffect(() => {
    active.current = true
    void readAccountId().then(value => { if (active.current) setOwner(value) }).catch(() => {})
    return () => { active.current = false; sequence.current += 1 }
  }, [])
  const begin = async () => {
    if (checking.current || !owner || !url || state === 'loading') return
    checking.current = true
    try {
      if (active.current && await readAccountId() === owner && active.current && sessionRevision() === revision) {
        sequence.current += 1; setAttempt(sequence.current); setState('loading')
      }
    } finally { checking.current = false }
  }
  const finish = async (next: 'loaded' | 'failed') => {
    if (active.current && sequence.current === attempt && await readAccountId() === owner && active.current && sequence.current === attempt && sessionRevision() === revision) setState(next)
  }
  return <View style={{ gap: 8, paddingVertical: 12 }}>
    <View style={{ minHeight: 48, gap: 8 }}>
      <Text style={styles.subtitle}>{description}{url ? ` · ${url.hostname}` : ' · 图片地址不可加载'}</Text>
      {url && state !== 'loaded' && <Pressable accessibilityRole="button" accessibilityLabel={`${state === 'failed' ? '重试加载' : '加载'}图片：${description}（${url.hostname}）`} accessibilityState={{ disabled: !owner || state === 'loading', busy: state === 'loading' }} disabled={!owner || state === 'loading'} onPress={() => { void begin().catch(() => {}) }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={styles.link}>{state === 'loading' ? '正在加载' : state === 'failed' ? '重试' : '加载图片'}</Text></Pressable>}
      {state === 'failed' && <Text accessibilityRole="alert" style={styles.subtitle}>图片加载失败</Text>}
    </View>
    {url && (state === 'loading' || state === 'loaded') && <Image key={attempt} accessibilityLabel={description} source={{ uri: url.href }} resizeMode="contain" style={{ width: '100%', height: 220 }} onLoad={() => { void finish('loaded').catch(() => {}) }} onError={() => { void finish('failed').catch(() => {}) }} />}
  </View>
}

export function ContentImage({ source, alt, remoteImagePolicy = 'confirm', imageSessionKey = '' }: { source: string; alt?: string; remoteImagePolicy?: RemoteImagePolicy; imageSessionKey?: string }) {
  const gate = useSessionGate()
  const id = /^attachment:\/\/([a-f0-9]{64})$/.exec(source)?.[1]
  const devicePath = !id ? deviceImagePath(source) : undefined
  const [resolved, setResolved] = useState<{ uri: string; headers?: Record<string, string> }>(), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setResolved(undefined); setError('')
    if (!id) return
    const load = async () => {
      try {
        const scope = captureRemoteScope()
        const owner = await readAccountId()
        const result = await integrationJson<{ url: string; authenticated: boolean }>(`/api/workspace/attachments/${id}/access`, {}, owner || undefined)
        const headers = result.authenticated ? { Authorization: `Bearer ${await accessToken(false, owner || undefined)}` } : undefined
        assertRemoteScope(scope)
        if (active && owner === await readAccountId()) { assertRemoteScope(scope); setResolved({ uri: result.url.startsWith('/') ? integrationBaseUrl + result.url : result.url, headers }) }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : '图片读取失败') }
    }
    void load(); return () => { active = false }
  }, [id, attempt, gate])
  if (id && gate.mode !== 'verified') return <Text style={styles.subtitle}>{alt || '内容图片'}：账号待核验，私有附件暂不可读取。</Text>
  if (devicePath) return <DeviceContentImage key={JSON.stringify([devicePath, imageSessionKey, sessionRevision()])} path={devicePath} alt={alt} revision={sessionRevision()} />
  if (!id && remoteImagePolicy === 'confirm') return <ConfirmedRemoteImage key={JSON.stringify([source, imageSessionKey, sessionRevision()])} source={source} alt={alt} revision={sessionRevision()} />
  if (id && error) return <View style={{ gap: 8, paddingVertical: 12 }}><Text accessibilityRole="alert" style={styles.subtitle}>{alt || '内容图片'}：{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="重试读取图片" onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.link}>重试读取图片</Text></Pressable></View>
  if (id && !resolved) return <Text style={styles.subtitle}>正在读取内容图片…</Text>
  return <Image accessibilityLabel={alt || '关键截图'} source={id ? resolved! : { uri: source }} resizeMode="contain" style={{ width: '100%', height: 220, marginVertical: 12 }} onError={() => { if (id) setError('图片暂不可用，请重试') }} />
}
