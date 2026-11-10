import { executeMeetingDeletion } from '../src/features/recording/meetingDeleteExecution'
test('moves exactly associated notes to trash before removing their recording while holding the lock', async () => {
  const order: string[] = []
  const ops = {
    guard: jest.fn(async () => {}),
    acquire: jest.fn(() => { order.push('lock'); return () => order.push('unlock') }),
    loadRecord: jest.fn(async () => ({ id: 'r1', noteId: 'n1' })),
    loadNotes: jest.fn(async () => [{ id: 'n1', task_id: 'r1' }, { id: 'other', task_id: 'r2' }]),
    trashNote: jest.fn(async (id: string) => { order.push(`trash:${id}`) }),
    removeOriginal: jest.fn(async () => { order.push('remove') }),
  }
  await executeMeetingDeletion('r1', ops)
  expect(order).toEqual(['lock', 'trash:n1', 'remove', 'unlock'])
  expect(ops.trashNote).not.toHaveBeenCalledWith('other')
})
test('preserves the original when note deletion fails', async () => {
  const release = jest.fn(), removeOriginal = jest.fn()
  const ops = { guard: async () => {}, acquire: () => release, loadRecord: async () => ({ id: 'r1' }),
    loadNotes: async () => [{ id: 'n1', task_id: 'r1' }], trashNote: async () => { throw new Error('无法删除纪要') }, removeOriginal }
  await expect(executeMeetingDeletion('r1', ops)).rejects.toThrow('无法删除纪要')
  expect(removeOriginal).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledTimes(1)
})
