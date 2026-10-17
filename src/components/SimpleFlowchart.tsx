import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Text } from './AppText'
import { colors, fontFamily } from '../design-system/theme'
import { flowLabelLines, parseSimpleFlowchart, type FlowEdge, type FlowPoint } from '../lib/simpleFlowchart'

function Segment({ start, end }: { start: FlowPoint; end: FlowPoint }) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
  return <View style={{ position: 'absolute', left: (start.x + end.x) / 2 - length / 2, top: (start.y + end.y) / 2 - 1,
    width: length, height: 2, backgroundColor: colors.ink, transform: [{ rotate: `${angle}deg` }] }} />
}

function Edge({ edge, width, height }: { edge: FlowEdge; width: number; height: number }) {
  const end = edge.points[edge.points.length - 1], before = edge.points[edge.points.length - 2]
  const angle = Math.atan2(end.y - before.y, end.x - before.x) * 180 / Math.PI
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
    {edge.points.slice(1).map((point, index) => <Segment key={index} start={edge.points[index]} end={point} />)}
    <View style={{ position: 'absolute', left: end.x - 9, top: end.y - 5, width: 0, height: 0,
      borderLeftWidth: 10, borderTopWidth: 5, borderBottomWidth: 5, borderLeftColor: colors.ink,
      borderTopColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: `${angle}deg` }] }} />
    {!!edge.label && <View style={{ position: 'absolute', left: edge.labelAt.x - 102, top: edge.labelAt.y - 30, width: 204, minHeight: 60,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, padding: 3 }}><Text style={{ color: colors.ink, fontFamily, fontSize: 13, lineHeight: 16, textAlign: 'center' }}>{flowLabelLines(edge.label).join('\n')}</Text></View>}
  </View>
}

/** Native nodes and computed lines only. No SVG/WebView or remote resources. */
export function SimpleFlowchart({ source }: { source: string }) {
  const result = useMemo(() => parseSimpleFlowchart(source), [source])
  const [expanded, setExpanded] = useState(false), [showSource, setShowSource] = useState(false), [showRelations, setShowRelations] = useState(false)
  const window = useWindowDimensions()
  const button = { minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 8 }
  return <View style={{ marginVertical: 12, gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, backgroundColor: colors.card }}>
    {result.ok ? <>
      <Text style={{ color: colors.ink, fontSize: 14 }}>{result.graph.nodes.length} 个节点 · {result.graph.edges.length} 条有向关系；可横向和纵向滚动</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={button}><Text style={{ color: colors.ink }}>{expanded ? '收起流程图' : '展开查看'}</Text></Pressable>
      <ScrollView horizontal nestedScrollEnabled style={{ height: Math.min(result.graph.height + 12, expanded ? window.height * 0.7 : 340), flexGrow: 0 }} accessibilityLabel="流程图横向滚动区域">
        <ScrollView nestedScrollEnabled style={{ width: result.graph.width, flexGrow: 0 }} accessibilityLabel="流程图纵向滚动区域">
          <View style={{ width: result.graph.width, height: result.graph.height, backgroundColor: colors.card }}>
            {result.graph.edges.map((edge, index) => <Edge key={index} edge={edge} width={result.graph.width} height={result.graph.height} />)}
            {result.graph.nodes.map(node => <View key={node.id} accessible accessibilityLabel={`${node.id}：${node.label}${node.shape === 'decision' ? '，判断' : ''}`} style={{ position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height,
              borderWidth: 2, borderColor: colors.ink, borderStyle: node.shape === 'decision' ? 'dashed' : 'solid', borderRadius: node.shape === 'round' ? 28 : 10,
              backgroundColor: colors.card, justifyContent: 'center', alignItems: 'center', padding: 10 }}>
              {node.shape === 'decision' && <Text style={{ position: 'absolute', left: 10, top: 4, fontSize: 11, color: colors.ink }}>判断</Text>}
              <Text style={{ color: colors.ink, fontFamily, fontSize: 14, lineHeight: 18, textAlign: 'center' }}>{flowLabelLines(node.label).join('\n')}</Text>
            </View>)}
          </View>
        </ScrollView>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showRelations }} onPress={() => setShowRelations(value => !value)} style={button}><Text style={{ color: colors.ink }}>步骤与关系（文字替代）</Text></Pressable>
      {showRelations && <View style={{ gap: 6 }}>{result.graph.nodes.map(node => <Text key={node.id} style={{ color: colors.ink }}>{node.id}：{node.label}{node.shape === 'decision' ? '（判断）' : ''}</Text>)}
        {result.graph.edges.map((edge, index) => <Text key={index} style={{ color: colors.ink }}>{result.graph.nodes.find(node => node.id === edge.from)!.label} → {result.graph.nodes.find(node => node.id === edge.to)!.label}{edge.label ? `；条件：${edge.label}` : ''}</Text>)}</View>}
    </> : <Text accessibilityRole="alert" style={{ color: colors.ink }}>暂无法显示此流程图：{result.reason}。源码与已有正文保留，不需要重新生成。</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSource }} onPress={() => setShowSource(value => !value)} style={button}><Text style={{ color: colors.ink }}>{showSource ? '收起源码' : '查看源码'}</Text></Pressable>
    {showSource && <Text selectable style={{ color: colors.ink, fontSize: 13, lineHeight: 20 }}>{source}</Text>}
  </View>
}
