import React from 'react'
import { Alert, Linking, ScrollView } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { colors } from '../design-system/theme'
import { markdownParser } from '../lib/markdown'

export function MeetingMarkdown({ content }: { content: string }) {
  return <Markdown markdownit={markdownParser} onLinkPress={url => {
    if (/^https?:\/\//i.test(url)) {
      void Linking.openURL(url).catch(() => Alert.alert('无法打开链接', '请检查链接或稍后重试。'))
    } else {
      Alert.alert('暂不支持此链接', '当前 App 仅支持打开网页链接，录音时间戳跳转尚未接入。')
    }
    return false
  }} rules={{
    table: (node, children) => <ScrollView key={node.key} horizontal contentContainerStyle={{ flexDirection: 'column', paddingBottom: 12 }}>{children}</ScrollView>,
  }} style={{
    body: { color: colors.ink, fontSize: 16, lineHeight: 27 },
    heading1: { fontSize: 24, lineHeight: 34, fontWeight: '700', marginTop: 20, marginBottom: 12 },
    heading2: { fontSize: 21, lineHeight: 30, fontWeight: '600', marginTop: 22, marginBottom: 10 },
    heading3: { fontSize: 18, lineHeight: 27, fontWeight: '600', marginTop: 18, marginBottom: 8 },
    paragraph: { marginTop: 4, marginBottom: 12 },
    bullet_list: { marginBottom: 12 }, ordered_list: { marginBottom: 12 },
    blockquote: { backgroundColor: colors.primarySoft, borderLeftColor: colors.primary, borderLeftWidth: 3, paddingHorizontal: 14, paddingVertical: 6 },
    link: { color: colors.primary },
    code_inline: { backgroundColor: colors.canvas, color: colors.ink },
    fence: { backgroundColor: colors.canvas, padding: 12, borderRadius: 8 },
    th: { minWidth: 130, maxWidth: 230, padding: 10, backgroundColor: colors.primarySoft },
    td: { minWidth: 130, maxWidth: 230, padding: 10 },
    tr: { borderBottomWidth: 1, borderColor: colors.line, flexDirection: 'row' },
    hr: { backgroundColor: colors.line, height: 1, marginVertical: 16 },
  }}>{content}</Markdown>
}
