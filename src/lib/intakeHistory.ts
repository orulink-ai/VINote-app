import { generationBaseUrl } from './integration'
import { intakeFileName, readIntake, type IntakeDraft } from './noteIntake'
import { readAccountId, sessionRevision } from './storage'

export type IntakeHistoryTarget = { owner: string; generationOrigin: string; operationId?: string; taskId?: string }
export type IntakeHistoryRecord = {
  title: string; status: string; help: string; action: string
  operationId?: string; taskId?: string; target?: IntakeHistoryTarget
}

export function intakeHistoryRecord(owner: string, draft: IntakeDraft, origin: string): IntakeHistoryRecord | null {
  if (!draft.operationId && !draft.taskId) return null
  const status = draft.execution === 'client' ? '设备处理记录，模型来源已固定' : !draft.generationOrigin ? '原服务未记录，暂不能安全核验'
    : draft.generationOrigin !== origin ? '原提交属于其他处理服务'
      : draft.receiptState === 'reserved' ? '已登记，受理待确认'
        : draft.uncertain || draft.receiptState === 'unknown' || !draft.taskId ? '提交结果待核验'
          : '任务已受理，结果待查询'
  const target = !!origin && draft.generationOrigin === origin
    ? { owner, generationOrigin: origin, operationId: draft.operationId, taskId: draft.taskId } : undefined
  return {
    title: draft.mode === 'file' ? draft.file ? intakeFileName(draft.file) : '已提交的文件' : draft.url || '已提交的链接',
    status, target, operationId: draft.operationId, taskId: draft.taskId,
    help: draft.execution === 'client' ? '返回读取此设备原操作；不会查询云任务或重复发送模型请求。' : target ? '这里只展示已保存的提交回执；返回来源页查询同一任务，不会在此重新提交。' : '原来源与编号保留，不会改绑当前服务或重新提交。',
    action: draft.taskId && !draft.uncertain && draft.receiptState !== 'reserved' && draft.receiptState !== 'unknown' ? '查看原任务' : '返回来源页核验',
  }
}

// Read only the current slot. Archived source-request records are not a complete history here.
export async function readCurrentIntakeHistory(owner: string): Promise<IntakeHistoryRecord | null> {
  const revision = sessionRevision()
  const guard = async () => {
    if (!owner || await readAccountId() !== owner || sessionRevision() !== revision) throw new Error('账号会话已变化，请重新读取来源任务')
  }
  await guard()
  const draft = await readIntake(owner)
  await guard()
  return intakeHistoryRecord(owner, draft, generationBaseUrl)
}

export function sameIntakeHistoryTarget(left?: IntakeHistoryTarget, right?: IntakeHistoryTarget) {
  return !!left && !!right && left.owner === right.owner && left.generationOrigin === right.generationOrigin
    && left.operationId === right.operationId && left.taskId === right.taskId
}
