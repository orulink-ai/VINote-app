const mockKeys = jest.fn(), mockGet = jest.fn(), mockRead = jest.fn()
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getAllKeys: (...args: unknown[]) => mockKeys(...args), getItem: (...args: unknown[]) => mockGet(...args) } }))
jest.mock('../src/lib/clientNotePipeline', () => ({ readClientNote: (...args: unknown[]) => mockRead(...args) }))
import { listClientNoteHistory, savedNoteForClientTask } from '../src/lib/clientNoteHistoryList'
const id = '4d030132-7222-401c-80c5-c352b0c1e5cf'
const draft = { execution: 'client', mode: 'url', url: 'https://example.com', operationId: id, taskId: id, submittedAt: '2026-11-06T10:00:00Z' }
beforeEach(() => { jest.clearAllMocks() })
test('lists only the current account durable records and their actual processing states', async () => {
  mockKeys.mockResolvedValue([`vinote:owner:client-note:${id}`, `vinote:other:client-note:${id}`])
  mockGet.mockResolvedValue(JSON.stringify({ owner: 'owner', operationId: id, draft }))
  mockRead.mockResolvedValue({ draft, taskId: id, status: 'running', message: '正在生成笔记', stage: 'llm' })
  const items = await listClientNoteHistory('owner', async () => {})
  expect(items).toHaveLength(1)
  expect(items[0]).toEqual(expect.objectContaining({ operationId: id, title: 'https://example.com', status: 'running', message: '正在生成笔记' }))
  expect(mockRead).toHaveBeenCalledTimes(1)
})
test('opens a saved note only for an unambiguous exact task association', () => {
  const item = { operationId: id, taskId: id, title: '来源', submittedAt: '', status: 'success' as const, message: '' }
  expect(savedNoteForClientTask(item, [{ id: 'note-1', task_id: id }, { id: 'unrelated', task_id: 'other' }])).toBe('note-1')
  expect(savedNoteForClientTask(item, [{ id: 'note-1', task_id: id }, { id: 'note-2', task_id: id }])).toBeUndefined()
  expect(savedNoteForClientTask({ ...item, status: 'running' }, [{ id: 'note-1', task_id: id }])).toBeUndefined()
})
test('keeps an unreadable record visible without making a model request', async () => {
  mockKeys.mockResolvedValue([`vinote:owner:client-note:${id}`])
  mockGet.mockResolvedValue('{invalid')
  expect(await listClientNoteHistory('owner', async () => {})).toEqual([expect.objectContaining({ operationId: id, status: 'unavailable' })])
  expect(mockRead).not.toHaveBeenCalled()
})
