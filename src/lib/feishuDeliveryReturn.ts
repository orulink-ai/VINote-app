import { identityEpoch } from './sessionIdentity'
import { readAccountId } from './storage'
import { readPublishDraft, type PublishDraft } from './feishuPublishReceipt'

export type FeishuDeliveryReturn = { noteId: string; noteKey: string; owner: string; epoch: number; operationId: string }
const consumed = new WeakSet<FeishuDeliveryReturn>()

export function deliverySettingsReturn(noteId: string, draft: PublishDraft): FeishuDeliveryReturn {
  return { noteId, noteKey: draft.noteKey, owner: draft.owner, epoch: identityEpoch(), operationId: draft.operationId }
}

export function deliveryReturnCurrent(value: FeishuDeliveryReturn, noteId: string | null) {
  return value.noteId === noteId && value.epoch === identityEpoch() && !consumed.has(value)
}

/** Only called after a successful saved-content read. No network write or navigation. */
export async function takeDeliveryReturn(value: FeishuDeliveryReturn, noteId: string, noteKey: string) {
  if (!deliveryReturnCurrent(value, noteId)) return false
  consumed.add(value)
  try {
    if (value.noteKey !== noteKey || await readAccountId() !== value.owner || value.epoch !== identityEpoch()) return false
    const draft = await readPublishDraft(value.owner, noteKey)
    return draft?.operationId === value.operationId && value.epoch === identityEpoch()
  } catch { return false }
}
