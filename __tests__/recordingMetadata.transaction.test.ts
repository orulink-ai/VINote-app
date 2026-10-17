import FS from 'react-native-fs'
import { readAccountId } from '../src/lib/storage'
import { saveRecording, listRecordings, renameRecording } from '../src/features/recording/recordingLibrary'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { acquireRecordingLock, reportGenerationProgress, acquireGenerationSlot } from '../src/features/recording/recordingProcessing'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn(async () => []) }))
const dir = '/documents/recordings/accounts/A'
const original = { id: 'original', uri: `file://${dir}/original.m4a`, title: '2026-10-12 10:30 | 会议录音', createdAt: '2026-10-12T02:30:00Z', duration: 4691,
  generation: { status: 'pending' as const, startedAt: '', asrModel: 'frozen-asr', llmModel: 'frozen-llm' } }
let disk: Map<string,string>, owner: string
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
beforeEach(() => {
  jest.clearAllMocks(); owner = 'A'; transitionIdentity(owner)
  ;(readAccountId as jest.Mock).mockImplementation(async () => owner)
  disk = new Map([[`${dir}/original.m4a`, 'audio'], [`${dir}/original.json`, JSON.stringify(original)]])
  ;(FS.mkdir as jest.Mock).mockResolvedValue(undefined)
  ;(FS.exists as jest.Mock).mockImplementation(async path => path === dir || disk.has(path))
  ;(FS.readDir as jest.Mock).mockImplementation(async () => [...disk].map(([path,value]) => ({ path, name: path.split('/').pop(), size: value.length })))
  ;(FS.readFile as jest.Mock).mockImplementation(async path => { if (!disk.has(path)) throw new Error('ENOENT'); return disk.get(path) })
  ;(FS.writeFile as jest.Mock).mockImplementation(async (path,body) => { disk.set(path,body) })
  ;(FS.unlink as jest.Mock).mockImplementation(async path => { disk.delete(path) })
  ;(FS.moveFile as jest.Mock).mockImplementation(async (from,to) => { if (!disk.has(from)) throw new Error('ENOENT'); disk.set(to,disk.get(from)!); disk.delete(from) })
})
test('reader waits through unlink/move gap and keeps title, time, models and checkpoints', async () => {
  let move!: () => void
  ;(FS.moveFile as jest.Mock).mockImplementationOnce(async (from,to) => { await new Promise<void>(resolve => { move = resolve }); disk.set(to,disk.get(from)!); disk.delete(from) })
  const next = { ...original, transcript: 'confirmed' }
  const writer = saveRecording(next); await tick(); expect(move).toBeDefined()
  expect(disk.has(`${dir}/original.json`)).toBe(false)
  let settled = false; const reader = listRecordings().then(value => { settled = true; return value })
  await tick(); expect(settled).toBe(false)
  move(); await writer
  expect(await reader).toEqual([next])
})
test('two same-id writers never share a live tmp file; final snapshot is complete', async () => {
  let write!: () => void
  ;(FS.writeFile as jest.Mock).mockImplementationOnce(async (path,body) => { disk.set(path,body); await new Promise<void>(resolve => { write = resolve }) })
  const first = saveRecording({ ...original, transcript: 'first' }); await tick()
  const second = saveRecording({ ...original, transcript: 'second' }); await tick()
  expect(FS.writeFile).toHaveBeenCalledTimes(1)
  write(); await Promise.all([first,second])
  expect(FS.writeFile).toHaveBeenCalledTimes(2)
  expect(await listRecordings()).toEqual([{ ...original, transcript: 'second' }])
})
test('failed rename leaves readable full tmp metadata and releases both locks', async () => {
  disk.set(`${dir}/original.json`, JSON.stringify({ ...original, generation: { ...original.generation, status: 'paused' } }))
  ;(FS.moveFile as jest.Mock).mockRejectedValueOnce(new Error('move failed'))
  await expect(renameRecording(original, '新名称')).rejects.toThrow('move failed')
  const rows = await listRecordings()
  expect(rows[0]).toMatchObject({ title: '新名称', createdAt: original.createdAt, generation: { asrModel: 'frozen-asr' } })
  const release = acquireRecordingLock('A','original'); release()
  await expect(saveRecording(rows[0])).resolves.toMatchObject({ title: '新名称' })
})
test('account change during tmp write rejects before unlink/commit and no data goes to B', async () => {
  let write!: () => void
  ;(FS.writeFile as jest.Mock).mockImplementationOnce(async (path,body) => { disk.set(path,body); await new Promise<void>(resolve => { write = resolve }) })
  const writer = saveRecording(original); const rejected = expect(writer).rejects.toMatchObject({ code: 'SESSION_SCOPE_CHANGED' })
  await tick(); owner = 'B'; transitionIdentity(owner); write(); await rejected
  expect(FS.unlink).not.toHaveBeenCalled(); expect(FS.moveFile).not.toHaveBeenCalled()
  expect([...disk.keys()].every(path => path.startsWith(dir))).toBe(true)
})
test('unreadable known metadata is a read error, never an invented orphan', async () => {
  disk.set(`${dir}/original.json`, '{incomplete')
  await expect(listRecordings()).rejects.toThrow('录音信息暂未读取')
  expect(FS.writeFile).not.toHaveBeenCalled(); expect(FS.unlink).not.toHaveBeenCalled()
})
test('active recording without readable metadata cannot be returned as unknown recovered recording', async () => {
  const release = acquireGenerationSlot()
  try {
    disk.delete(`${dir}/original.json`); reportGenerationProgress('A','original','正在处理')
    await expect(listRecordings()).rejects.toThrow('录音信息暂未读取')
  } finally { release() }
})

test('rename account switch during its write cannot commit or retain the recording lock', async () => {
  disk.set(`${dir}/original.json`, JSON.stringify({ ...original, generation: { ...original.generation, status: 'paused' } }))
  let write!: () => void
  ;(FS.writeFile as jest.Mock).mockImplementationOnce(async (path,body) => { disk.set(path,body); await new Promise<void>(resolve => { write = resolve }) })
  const rename = renameRecording(original,'changed'); const rejected = expect(rename).rejects.toMatchObject({ code:'SESSION_SCOPE_CHANGED' })
  await tick(); expect(write).toBeDefined(); owner='B'; transitionIdentity(owner); write(); await rejected
  expect(FS.unlink).not.toHaveBeenCalled(); expect(FS.moveFile).not.toHaveBeenCalled()
  const release=acquireRecordingLock('A','original'); release()
})
test('A to B to A during metadata read rejects an old epoch even when owner matches again', async () => {
  let read!: () => void
  ;(FS.readFile as jest.Mock).mockImplementationOnce(async path => { await new Promise<void>(resolve => { read=resolve }); return disk.get(path) })
  const listing = listRecordings(); const rejected = expect(listing).rejects.toMatchObject({ code:'SESSION_SCOPE_CHANGED' })
  await tick(); transitionIdentity('B'); transitionIdentity('A'); read(); await rejected
  expect(FS.writeFile).not.toHaveBeenCalled()
})
