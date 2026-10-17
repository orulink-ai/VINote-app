import { listLocalFiles, type LocalFile } from './localFiles'
import { listLocalFileAssociations } from './localFileAssociations'
import { readAccountId } from './storage'
import { readWorkspace } from './workspaceStorage'
import type { Note } from '../types/api'

/** Resolve verified originals from account-scoped IDs, never titles or media URLs. */
export async function noteSourceFiles(note: Note, owner: string): Promise<LocalFile[]> {
  const guard = async () => { if (!owner || await readAccountId() !== owner) throw new Error('账号已变化，请返回内容详情重新打开来源') }
  await guard()
  const [files, snapshot] = await Promise.all([listLocalFiles(owner), readWorkspace(owner)])
  await guard()
  const mapping = Object.values(snapshot.mappings).find(row => row.localIds.includes(note.id) || !!note.workspace_key && row.key === note.workspace_key)
  const ids = new Set([note.id, ...(mapping?.localIds || [])])
  const found: LocalFile[] = []
  for (const file of files) {
    const associations = await listLocalFileAssociations(owner, file.id)
    await guard()
    if (associations.some(row => row.state === 'saved' && !!row.noteId && ids.has(row.noteId))) found.push(file)
  }
  return found
}
