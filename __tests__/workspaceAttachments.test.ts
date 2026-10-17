import { prepareWorkspaceMarkdown } from '../src/lib/workspaceAttachments'
import FS from 'react-native-fs'
import { integrationJson } from '../src/lib/integration'
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn() }))
beforeEach(() => jest.clearAllMocks())

test.each([
  '![图](file:///private/image.png)',
  '![图](/api/task/fixture/artifacts/frame.png)\n[02:00](/api/task/fixture/artifacts/source.mp4?t=120)',
  '![已保存](attachment://' + 'a'.repeat(64) + ')',
])('cancelled attachment synchronization preserves the saved Markdown without remote portability claims: %s', async markdown => {
  const download = jest.fn()
  Object.assign(FS, { downloadFile: download })
  expect(await prepareWorkspaceMarkdown(markdown, 'owner')).toBe(markdown)
  expect(integrationJson).not.toHaveBeenCalled()
  expect(download).not.toHaveBeenCalled()
  expect(FS.copyFile).not.toHaveBeenCalled()
  expect(FS.writeFile).not.toHaveBeenCalled()
})

test('a stale caller guard rejects preparation before any file or remote operation', async () => {
  await expect(prepareWorkspaceMarkdown('saved Markdown', 'owner', undefined, () => { throw new Error('scope changed') }))
    .rejects.toThrow('scope changed')
  expect(integrationJson).not.toHaveBeenCalled()
  expect(FS.copyFile).not.toHaveBeenCalled()
})
