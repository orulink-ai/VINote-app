import { createNote, getNote, renameNote, deleteNote, listNotes, shareNoteFile } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
import FS from 'react-native-fs'
import Share from 'react-native-share'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
test('local minutes are isolated by account and support rename and delete', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  const note = await createNote({ title: '会议', content: '# 决议', task_id: 'r1' }, 'alice')
  expect((await renameNote(note.id, '新名称')).title).toBe('新名称')
  jest.mocked(readAccountId).mockResolvedValue('bob')
  expect(await listNotes()).toEqual([])
  await expect(getNote(note.id)).rejects.toThrow('未找到')
  await expect(createNote({ title: '会议', content: '私密', task_id: 'r2' }, 'alice')).rejects.toThrow('账号已切换')
  jest.mocked(readAccountId).mockResolvedValue('alice')
  await deleteNote(note.id)
  await expect(getNote(note.id)).rejects.toThrow('未找到')
})
test('each generation of the same audio keeps an independent numbered note', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  const first = await createNote({ title: '同一段录音', content: '# 第一版', task_id: 'record-version' }, 'alice')
  const second = await createNote({ title: '同一段录音', content: '# 第二版', task_id: 'record-version' }, 'alice')
  expect(first).toMatchObject({ id: 'app-record-version', version: 1 })
  expect(second).toMatchObject({ id: 'app-record-version-v2', version: 2 })
  expect((await listNotes()).filter(note => note.task_id === 'record-version')).toHaveLength(2)
  expect((await getNote(first.id)).content).toBe('# 第一版')
})
test('creating an occupied version never overwrites the previous note', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  const first = await createNote({ title: '录音', content: '# 原纪要', task_id: 'collision' }, 'alice', 1)
  await expect(createNote({ title: '录音', content: '# 新纪要', task_id: 'collision' }, 'alice', 1)).rejects.toThrow('已存在')
  expect((await getNote(first.id)).content).toBe('# 原纪要')
})
test('shares the selected version as a Markdown file kept available for the receiving app', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  const note = await createNote({ title: '客户/会议', content: '# 第二版\n行动项', task_id: 'share-version' }, 'alice', 2)
  await shareNoteFile(note)
  expect(FS.writeFile).toHaveBeenCalledWith(expect.stringMatching(/客户_会议_v2\.md$/), note.content, 'utf8')
  expect(Share.open).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/客户_会议_v2\.md$/), type: 'text/markdown' }))
  expect(FS.unlink).not.toHaveBeenCalled()
})
