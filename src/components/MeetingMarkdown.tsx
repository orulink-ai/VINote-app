import { Text } from './AppText'
import React from 'react'
import { Alert, Linking, ScrollView, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { colors, fontFamily } from '../design-system/theme'
import { markdownParser } from '../lib/markdown'
import { ContentImage, type RemoteImagePolicy } from './ContentImage'
import { SimpleFlowchart } from './SimpleFlowchart'
import { devReadDuration, devReadTiming, readTimingEnabled } from '../lib/storage'

const onMarkdownRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  devReadDuration?.('markdown.render', actualDuration)
}

export function MeetingMarkdown({
  content,
  onTimestamp,
  remoteImagePolicy = 'confirm',
  imageSessionKey = '',
}: {
  content: string
  onTimestamp?: (seconds: number) => void
  remoteImagePolicy?: RemoteImagePolicy
  imageSessionKey?: string
}) {
  const prepared = devReadTiming?.('markdown.prepare')
  const rendered = (
    <Markdown
      key={JSON.stringify([content, remoteImagePolicy, imageSessionKey])}
      markdownit={markdownParser}
      onLinkPress={url => {
        if (/^https?:\/\//i.test(url)) {
          void Linking.openURL(url).catch(() =>
            Alert.alert('无法打开链接', '请检查链接或稍后重试。'),
          )
        } else {
          Alert.alert(
            '暂不支持此链接',
            '当前 App 仅支持打开网页链接，录音时间戳跳转尚未接入。',
          )
        }
        return false
      }}
      rules={{
        fence: (node, _children, _parents, ruleStyles) => (node as typeof node & { sourceInfo?: string }).sourceInfo?.trim() === 'mermaid'
          ? <SimpleFlowchart key={node.key} source={node.content} />
          : <Text key={node.key} selectable style={ruleStyles.fence}>{node.content}</Text>,
        // Paragraphs wrap in a row. Give images their own full-width block so
        // the inner 100% Image is not sized against the alt text's intrinsic width.
        image: node => <View key={node.key} style={{ width: '100%', flexShrink: 0 }}><ContentImage source={node.attributes.src} alt={node.attributes.alt || node.content} remoteImagePolicy={remoteImagePolicy} imageSessionKey={imageSessionKey} /></View>,
        text: (node, _children, parents) => {
          if (
            !onTimestamp ||
            parents.some(parent =>
              ['link', 'blocklink', 'code_inline', 'fence'].includes(
                parent.type,
              ),
            )
          )
            return <Text key={node.key}>{node.content}</Text>
          const pieces: React.ReactNode[] = []
          const pattern = /\[(\d{1,3}):([0-5]\d)(?:[–-]\d{1,3}:[0-5]\d)?\]/g
          let position = 0
          for (const match of node.content.matchAll(pattern)) {
            const index = match.index!
            if (index > position)
              pieces.push(node.content.slice(position, index))
            const seconds = Number(match[1]) * 60 + Number(match[2])
            pieces.push(
              <Text
                key={index}
                accessibilityRole="link"
                accessibilityLabel={`回听${match[0]}`}
                onPress={() => onTimestamp(seconds)}
                style={{
                  color: colors.primary,
                  textDecorationLine: 'underline',
                }}
              >
                {match[0]}
              </Text>,
            )
            position = index + match[0].length
          }
          if (!position) return <Text key={node.key}>{node.content}</Text>
          if (position < node.content.length)
            pieces.push(node.content.slice(position))
          return <Text key={node.key}>{pieces}</Text>
        },
        table: (node, children) => (
          <ScrollView
            key={node.key}
            horizontal
            contentContainerStyle={{
              flexDirection: 'column',
              paddingBottom: 12,
            }}
          >
            {children}
          </ScrollView>
        ),
      }}
      style={{
        body: { fontFamily, color: colors.ink, fontSize: 14, lineHeight: 24 },
        heading1: {
          fontSize: 20,
          lineHeight: 34,
          fontWeight: '700',
          marginTop: 20,
          marginBottom: 12,
        },
        heading2: {
          fontSize: 16,
          lineHeight: 30,
          fontWeight: '600',
          marginTop: 22,
          marginBottom: 10,
        },
        heading3: {
          fontSize: 16,
          lineHeight: 24,
          fontWeight: '600',
          marginTop: 18,
          marginBottom: 8,
        },
        paragraph: { marginTop: 4, marginBottom: 12 },
        bullet_list: { marginBottom: 12 },
        ordered_list: { marginBottom: 12 },
        blockquote: {
          backgroundColor: colors.primarySoft,
          borderLeftColor: colors.primary,
          borderLeftWidth: 3,
          paddingHorizontal: 14,
          paddingVertical: 6,
        },
        link: { color: colors.primary },
        code_inline: { backgroundColor: colors.canvas, color: colors.ink },
        fence: { backgroundColor: colors.canvas, padding: 12, borderRadius: 8 },
        th: {
          minWidth: 130,
          maxWidth: 230,
          padding: 10,
          backgroundColor: colors.primarySoft,
        },
        td: { minWidth: 130, maxWidth: 230, padding: 10 },
        tr: {
          borderBottomWidth: 1,
          borderColor: colors.line,
          flexDirection: 'row',
        },
        hr: { backgroundColor: colors.line, height: 1, marginVertical: 16 },
      }}
    >
      {content}
    </Markdown>
  )
  prepared?.()
  return readTimingEnabled?.()
    ? <React.Profiler id="anonymous-markdown" onRender={onMarkdownRender}>{rendered}</React.Profiler>
    : rendered
}
