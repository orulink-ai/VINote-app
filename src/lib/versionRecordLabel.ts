/** Missing legacy metadata is not evidence that a model generated the record. */
export function versionRecordLabel(kind?: string): string {
  return ({ generated: '生成版本', edit: '编辑记录', imported: '导入记录' } as Record<string, string>)[kind || ''] || '保存记录'
}
export function versionRecordTime(value?: string): string {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '保存时间未记录'
}
