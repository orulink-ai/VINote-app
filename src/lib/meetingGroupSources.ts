import { listRecordings } from '../features/recording/recordingLibrary'
import { listLocalFiles } from './localFiles'
import { listLocalFileAssociations } from './localFileAssociations'
import { readWorkspace } from './workspaceStorage'
import { readAccountId } from './storage'
import { identityEpoch, SessionScopeChangedError } from './sessionIdentity'
import type { Note } from '../types/api'
import type { MeetingSource } from './meetingGroups'

/** Read existing metadata only. No sync, generation, original copying or repair. */
export async function readMeetingGroupSources(notes: Note[]) {
  const epoch = identityEpoch(), owner = await readAccountId()
  const guard = async () => {
    if (!owner || identityEpoch() !== epoch || await readAccountId() !== owner || identityEpoch() !== epoch) throw new SessionScopeChangedError()
  }
  await guard()
  const [recordings, files, snapshot] = await Promise.all([listRecordings(), listLocalFiles(owner!), readWorkspace(owner!)])
  await guard()
  const sources: MeetingSource[] = [], recordingIds = new Set(recordings.map(row => row.id))
  const meetingNotes = notes.filter(note => !note.deleted && (note.source_type || '').startsWith('meeting'))
  for (const note of meetingNotes) {
    // task_id is a recording ID only when that recording actually exists in this account.
    if (note.task_id && recordingIds.has(note.task_id)) sources.push({ owner: owner!, noteId: note.id, kind: 'recording', sourceId: note.task_id })
  }
  for (const file of files) {
    const associations = await listLocalFileAssociations(owner!, file.id)
    await guard()
    for (const note of meetingNotes) {
      const ids = new Set([note.id])
      for (const mapping of Object.values(snapshot.mappings)) {
        if (mapping.localIds.includes(note.id) || !!note.workspace_key && mapping.key === note.workspace_key) mapping.localIds.forEach(id => ids.add(id))
      }
      if (associations.some(row => row.owner === owner && row.localFileId === file.id && row.state === 'saved' && !!row.noteId && ids.has(row.noteId))) {
        sources.push({ owner: owner!, noteId: note.id, kind: 'file', sourceId: file.id })
      }
    }
  }
  await guard()
  return { owner: owner!, epoch, sources }
}
