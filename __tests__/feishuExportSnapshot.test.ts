import FS from 'react-native-fs'
import Share from 'react-native-share'
import { exportNoteFile } from '../src/lib/notes'
import type { Note } from '../src/types/api'
import { feishuExportSnapshot } from '../src/lib/feishuExportSnapshot'
const note = { id: 'saved-note', title: '新标题', content: '新正文', transcript: { full_text: '当前逐字稿' } }
it('exports the displayed frozen title and body while preserving saved identity without mutating either source', () => {
  const snapshot = Object.freeze({ title: '原标题', content: '固定正文' })
  const result = feishuExportSnapshot(note, snapshot)
  expect(result).toMatchObject({ id: 'saved-note', title: '原标题', content: '固定正文' })
  expect(note.content).toBe('新正文'); expect(snapshot.content).toBe('固定正文')
})
it('adds a current transcript only when explicitly selected and labels it separately', () => {
  const snapshot = { title: '原标题', content: '固定正文' }
  expect(feishuExportSnapshot(note, snapshot, true).content).toBe('固定正文\n\n## 逐字稿（当前内容附件）\n\n当前逐字稿')
  expect(feishuExportSnapshot({ ...note, transcript: undefined }, snapshot, true).content).toBe('固定正文')
})
it('keeps normal current-content export when no publication snapshot exists', () => {
  expect(feishuExportSnapshot(note).content).toBe('新正文')
  expect(feishuExportSnapshot(note, undefined, true).content).toBe('新正文\n\n## 逐字稿\n\n当前逐字稿')
})


it('file name and share label do not attribute the current version number to a frozen body', async () => {
  jest.clearAllMocks()
  await exportNoteFile(feishuExportSnapshot({ ...note, version: 9 } as Note, { title: '冻结标题', content: '冻结正文' }), true)
  expect(FS.writeFile).toHaveBeenCalledWith('/cache/vinote-share-saved-note/冻结标题_发布正文快照.md', '冻结正文', 'utf8')
  expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({ title: '分享冻结标题（发布正文快照）', saveToFiles: true }))
  expect(JSON.stringify(jest.mocked(Share.open).mock.calls)).not.toContain('版本 9')
})

it('ordinary current-note export retains its real version label', async () => {
  jest.clearAllMocks()
  await exportNoteFile({ ...note, version: 9 } as Note)
  expect(FS.writeFile).toHaveBeenCalledWith('/cache/vinote-share-saved-note/新标题_v9.md', '新正文', 'utf8')
  expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({ title: '分享新标题（版本 9）' }))
})
