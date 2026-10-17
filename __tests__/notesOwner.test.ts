import Storage from '@react-native-async-storage/async-storage'
import { editNoteContent } from '../src/lib/notes'
import { readAccountId } from '../src/lib/storage'
import { requestWorkspaceSync } from '../src/lib/workspace'
import type { Note } from '../src/types/api'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({ requestWorkspaceSync: jest.fn() }))

const originalGet = jest.mocked(Storage.getItem).getMockImplementation()!
const originalSet = jest.mocked(Storage.setItem).getMockImplementation()!
const noteKey = (owner: string) => `vinote:${owner}:note:same-id`
const historyKey = (owner: string) => `vinote:${owner}:note-history:same-id`
const source: Note = { id: 'same-id', title: 'Frozen source', content: 'same baseline',
  workspace_revision: 7, status: 'done', created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-12T00:00:00Z' }
const earlier = [{ content: 'earlier original', savedAt: '2026-10-11T00:00:00Z' }]
let account: string | null

beforeEach(async () => {
  jest.mocked(Storage.getItem).mockImplementation(originalGet)
  jest.mocked(Storage.setItem).mockImplementation(originalSet)
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
  account = 'alice'
  jest.mocked(readAccountId).mockImplementation(async () => account)
  for (const owner of ['alice', 'bob']) {
    await Storage.setItem(noteKey(owner), JSON.stringify(source))
    await Storage.setItem(historyKey(owner), JSON.stringify(earlier))
  }
  jest.clearAllMocks()
})

async function assertBobUntouched() {
  expect(JSON.parse((await originalGet(noteKey('bob')))!)).toEqual(source)
  expect(JSON.parse((await originalGet(historyKey('bob')))!)).toEqual(earlier)
  expect(jest.mocked(Storage.setItem).mock.calls.some(([key]) => key.startsWith('vinote:bob:'))).toBe(false)
}

test('an old owner cannot write identical-id identical-baseline notes in the newly signed-in account', async () => {
  account = 'bob'
  await expect(editNoteContent(source.id, 'alice translation', source, 'alice')).rejects.toThrow('账号已切换')
  expect(Storage.getItem).not.toHaveBeenCalled()
  expect(Storage.setItem).not.toHaveBeenCalled()
  await assertBobUntouched()
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test.each(['note', 'workspace', 'history'])('switching owner during %s read stops before either write', async stage => {
  const trigger = stage === 'note' ? noteKey('alice') : stage === 'workspace' ? 'vinote:alice:workspace' : historyKey('alice')
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    const value = await originalGet(key)
    if (key === trigger) account = 'bob'
    return value
  })
  await expect(editNoteContent(source.id, 'alice translation', source, 'alice')).rejects.toThrow('账号已切换')
  expect(Storage.setItem).not.toHaveBeenCalled()
  expect(jest.mocked(Storage.getItem).mock.calls.some(([key]) => key.startsWith('vinote:bob:'))).toBe(false)
  await assertBobUntouched()
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test('the owner is rechecked immediately before history commit, after the history read check', async () => {
  let historyRead = false, checks = 0
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    const value = await originalGet(key)
    if (key === historyKey('alice')) historyRead = true
    return value
  })
  jest.mocked(readAccountId).mockImplementation(async () => {
    if (historyRead && ++checks === 2) account = 'bob'
    return account
  })
  await expect(editNoteContent(source.id, 'alice translation', source, 'alice')).rejects.toThrow('账号已切换')
  expect(Storage.setItem).not.toHaveBeenCalled()
  await assertBobUntouched()
})

test('switching during history commit preserves the original and stops the body commit', async () => {
  jest.mocked(Storage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value)
    if (key === historyKey('alice')) account = 'bob'
  })
  await expect(editNoteContent(source.id, 'alice translation', source, 'alice')).rejects.toThrow('账号已切换')
  expect(JSON.parse((await originalGet(noteKey('alice')))!)).toEqual(source)
  expect(JSON.parse((await originalGet(historyKey('alice')))!)).toEqual([
    ...earlier, { content: source.content, savedAt: source.updated_at }])
  expect(Storage.setItem).toHaveBeenCalledTimes(1)
  await assertBobUntouched()
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test('a switch during body commit cannot acknowledge or synchronize under the new account', async () => {
  jest.mocked(Storage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value)
    if (key === noteKey('alice')) account = 'bob'
  })
  await expect(editNoteContent(source.id, 'alice translation', source, 'alice')).rejects.toThrow('账号已切换')
  await assertBobUntouched()
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test('valid owner edits retain CAS baseline and commit original history before the new body', async () => {
  const saved = await editNoteContent(source.id, 'alice translation', source, 'alice')
  expect(saved.workspace_revision).toBe(7)
  expect(saved.content).toBe('alice translation')
  expect(jest.mocked(Storage.setItem).mock.calls.map(([key]) => key)).toEqual([historyKey('alice'), noteKey('alice')])
  expect(JSON.parse((await originalGet(historyKey('alice')))!)).toEqual([
    ...earlier, { content: source.content, savedAt: source.updated_at }])
  await assertBobUntouched()
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test('same content with a changed revision still rejects the old CAS baseline before history changes', async () => {
  await originalSet(noteKey('alice'), JSON.stringify({ ...source, workspace_revision: 8 }))
  await expect(editNoteContent(source.id, 'draft', source, 'alice')).rejects.toThrow('正文已有新修订')
  expect(Storage.setItem).not.toHaveBeenCalled()
  expect(JSON.parse((await originalGet(historyKey('alice')))!)).toEqual(earlier)
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test('body write failure keeps the original body and durable original history', async () => {
  jest.mocked(Storage.setItem).mockImplementation(async (key, value) => {
    if (key === noteKey('alice')) throw new Error('storage full')
    await originalSet(key, value)
  })
  await expect(editNoteContent(source.id, 'draft', source, 'alice')).rejects.toThrow('storage full')
  expect(JSON.parse((await originalGet(noteKey('alice')))!)).toEqual(source)
  expect(JSON.parse((await originalGet(historyKey('alice')))!)).toEqual([
    ...earlier, { content: source.content, savedAt: source.updated_at }])
  await assertBobUntouched()
  expect(requestWorkspaceSync).not.toHaveBeenCalled()
})

test('legacy callers without expectedOwner also retain the owner captured at entry', async () => {
  jest.mocked(Storage.getItem).mockImplementation(async key => {
    const value = await originalGet(key)
    if (key === noteKey('alice')) account = 'bob'
    return value
  })
  await expect(editNoteContent(source.id, 'draft', source)).rejects.toThrow('账号已切换')
  expect(Storage.setItem).not.toHaveBeenCalled()
  await assertBobUntouched()
})

test('missing current session cannot read or write an explicitly bound owner note', async () => {
  account = null
  await expect(editNoteContent(source.id, 'draft', source, 'alice')).rejects.toThrow('账号已切换')
  expect(Storage.getItem).not.toHaveBeenCalled()
  expect(Storage.setItem).not.toHaveBeenCalled()
})
