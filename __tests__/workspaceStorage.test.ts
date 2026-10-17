import Storage from '@react-native-async-storage/async-storage'
import FS from 'react-native-fs'
import { readWorkspace, writeWorkspace } from '../src/lib/workspaceStorage'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'cache-owner') }))

beforeEach(async () => {
  jest.clearAllMocks()
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})

it('stores large version bodies in files with a small committed pointer', async () => {
  const files = new Map<string, string>()
  jest.mocked(FS.writeFile).mockImplementation(async (path, body) => { files.set(path, body); return undefined as never })
  jest.mocked(FS.readFile).mockImplementation(async path => files.get(path)!)
  const state = { mappings: {}, cache: {}, error: '中'.repeat(800000) }
  await writeWorkspace('cache-owner', state)
  expect((await Storage.getItem('vinote:cache-owner:workspace-file'))!.length).toBeLessThan(200)
  expect(await readWorkspace('cache-owner')).toEqual(state)
  expect(FS.moveFile).not.toHaveBeenCalled()
})

it('does not change the committed pointer when writing the new snapshot fails', async () => {
  await Storage.setItem('vinote:cache-owner:workspace-file', '{"file":"1-abcd"}')
  jest.mocked(FS.writeFile).mockRejectedValueOnce(new Error('disk full'))
  await expect(writeWorkspace('cache-owner', { mappings: {}, cache: {} })).rejects.toThrow('disk full')
  expect(await Storage.getItem('vinote:cache-owner:workspace-file')).toBe('{"file":"1-abcd"}')
  expect(FS.unlink).not.toHaveBeenCalled()
})
