import { planMeetingDeletion } from './meetingDeletePlan'

type RecordRef = { id: string; noteId?: string }
type Operations<T extends RecordRef> = {
  guard: () => Promise<void>
  acquire: () => () => void
  loadRecord: () => Promise<T>
  loadNotes: () => Promise<Array<{ id: string; task_id?: string | null }>>
  trashNote: (id: string) => Promise<void>
  removeOriginal: (record: T) => Promise<void>
}

/** Preserve the original if a note cannot be moved to trash; never infer links. */
export async function executeMeetingDeletion<T extends RecordRef>(recordId: string, ops: Operations<T>): Promise<void> {
  await ops.guard()
  const release = ops.acquire()
  try {
    await ops.guard()
    const record = await ops.loadRecord()
    await ops.guard()
    if (record.id !== recordId) throw new Error('会议已变化，请重新核对')
    const notes = await ops.loadNotes()
    await ops.guard()
    const ids = planMeetingDeletion(record, notes)
    for (const id of ids) { await ops.guard(); await ops.trashNote(id); await ops.guard() }
    await ops.guard()
    await ops.removeOriginal(record)
    await ops.guard()
  } finally { release() }
}
