import FS from 'react-native-fs'
import { deleteLocalFile } from '../src/lib/localFiles'
import { readAccountId } from '../src/lib/storage'
import { identityEpoch, transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
const file = { id: '11111111-1111-4111-8111-111111111111', name: 'original.docx', uri: 'file:///documents/files/accounts/owner/11111111-1111-4111-8111-111111111111.docx', category: 'file' as const, extension: 'docx', size: 20, createdAt: '' }
beforeEach(() => { jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('owner'); jest.mocked(FS.exists).mockReset().mockResolvedValue(true) })
test.each(['route', 'aba', 'owner'])('delayed exists cannot delete after %s invalidation', async change => {
  let finish!: (value: boolean) => void, current = true
  jest.mocked(FS.exists).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const operation = deleteLocalFile(file, 'owner', identityEpoch(), () => current)
  const assertion = expect(operation).rejects.toThrow()
  await new Promise<void>(resolve => setImmediate(resolve))
  if (change === 'route') current = false
  if (change === 'aba') { transitionIdentity('B'); transitionIdentity('owner') }
  if (change === 'owner') jest.mocked(readAccountId).mockResolvedValue('B')
  finish(true); await assertion; expect(FS.unlink).not.toHaveBeenCalled()
})
test('normal deletion removes only fixed original and metadata paths', async () => {
  await deleteLocalFile(file, 'owner', identityEpoch(), () => true)
  expect(jest.mocked(FS.unlink).mock.calls.map(args => args[0])).toEqual([file.uri, '/documents/files/accounts/owner/11111111-1111-4111-8111-111111111111.meta.json', '/documents/files/accounts/owner/11111111-1111-4111-8111-111111111111.purpose.json'])
})
