export type SpeakerProgress = {
  phase: 'preparing' | 'detection' | 'features' | 'saving' | 'saved'
  attempt: string
  percent?: number
  unit?: { index: number; total?: number }
}
export function speakerPhaseLabel(detail: SpeakerProgress): string {
  const label = { preparing: '准备分析', detection: '检测发言区间', features: '核对声音特征', saving: '保存分析结果', saved: '已保存' }[detail.phase]
  if (!detail.unit) return label
  return `${label} · 第 ${detail.unit.index}${detail.unit.total ? `/${detail.unit.total}` : ''} ${detail.phase === 'detection' ? '窗' : '批'}`
}
