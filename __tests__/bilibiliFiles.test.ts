import FS from 'react-native-fs'
import Storage from '@react-native-async-storage/async-storage'
import { registerBilibiliFile } from '../src/lib/localFiles'
import { saveSourceNote, getNote, editNoteContent } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
import type { BilibiliSource } from '../src/types/bilibili'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'alice') }))
const id = '12345678-1234-4234-8234-123456789012'
const source: BilibiliSource = { platform: 'bilibili', operationId: id, originalUrl: 'https://b23.tv/example', canonicalUrl: 'https://www.bilibili.com/video/BV1234567890?p=2', bvid: 'BV1234567890', page: 2, aid: '1', cid: '2', duration: 40 }
const cache = `file:///cache/bilibili-${id}.m4a`
beforeEach(async () => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('alice')
  jest.mocked(FS.exists).mockResolvedValue(false)
  jest.mocked(FS.stat).mockResolvedValue({ size: 100 } as never)
  jest.mocked(FS.moveFile).mockResolvedValue(undefined)
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
test('verified native cache atomically registers in account note files, retaining provenance', async () => {
  const file = await registerBilibiliFile('alice', id, cache, '示例', 100, source, async () => {})
  expect(file).toMatchObject({ purpose: 'note', category: 'audio', source: 'bilibili', bilibiliSource: source, uri: `file:///documents/files/accounts/alice/${id}.m4a` })
  expect(FS.moveFile).toHaveBeenNthCalledWith(1, cache, `/documents/files/accounts/alice/${id}.m4a`)
  expect(FS.writeFile).toHaveBeenCalledWith(`/documents/files/accounts/alice/${id}.meta.json.tmp`, JSON.stringify(file), 'utf8')
  expect(JSON.stringify(jest.mocked(FS.moveFile).mock.calls)).not.toContain('/recordings/')
})
test('cancel after binary move cleans unpublished binary instead of registering for another account', async () => {
  let cancelled = false
  jest.mocked(FS.moveFile).mockImplementationOnce(async () => { cancelled = true })
  await expect(registerBilibiliFile('alice', id, cache, '示例', 100, source, async () => { if (cancelled) throw new Error('cancelled') })).rejects.toThrow('cancelled')
  expect(FS.writeFile).not.toHaveBeenCalled()
  expect(FS.unlink).toHaveBeenCalledWith(`/documents/files/accounts/alice/${id}.m4a`)
})
test('existing file is never overwritten or deleted', async () => {
  jest.mocked(FS.exists).mockResolvedValueOnce(true)
  await expect(registerBilibiliFile('alice', id, cache, '示例', 100, source, async () => {})).rejects.toThrow('不会覆盖')
  expect(FS.moveFile).not.toHaveBeenCalled(); expect(FS.unlink).not.toHaveBeenCalled()
})
test('saved source remains in a note after reopening and editing', async () => {
  const note = await saveSourceNote(id, '来源笔记', '# 原正文', 'audio', 'alice', '2026-10-17T00:00:00Z', source)
  expect((await getNote(note.id, { expectedOwner: 'alice' })).bilibili_source).toEqual(source)
  await editNoteContent(note.id, '# 编辑后的正文', { content: note.content, workspace_revision: note.workspace_revision })
  expect((await getNote(note.id, { expectedOwner: 'alice' })).bilibili_source).toEqual(source)
})
