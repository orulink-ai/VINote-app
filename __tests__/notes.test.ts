import { createNote, getNote, renameNote, deleteNote, listNotes } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
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
