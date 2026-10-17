import { prepareWorkspaceMarkdown } from '../src/lib/workspaceAttachments'
import FS from 'react-native-fs'
import { integrationJson } from '../src/lib/integration'
import { beginVerification, finishVerification } from '../src/lib/sessionGate'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'fixture') }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'http://127.0.0.1:8900', integrationBaseUrl: 'https://supabase-vinote.orulink.ai/vinote-api', operationId: () => 'temporary-fixture', integrationJson: jest.fn() }))

beforeEach(() => { jest.clearAllMocks(); finishVerification(beginVerification('owner'), 'verified') })
it('does not discard an unsupported device image or falsely mark it portable', async () => {
  await expect(prepareWorkspaceMarkdown('![图](file:///private/image.png)', 'owner')).rejects.toThrow('图片暂不能跨设备读取')
  expect(integrationJson).not.toHaveBeenCalled()
})
it('only uploads content images, preserving shared references and readable recording offsets', async () => {
  const reference = 'attachment://' + 'a'.repeat(64)
  const download = jest.fn((_options: { fromUrl: string }) => ({ jobId: 1, promise: Promise.resolve({ statusCode: 200, bytesWritten: 8 }) }))
  Object.assign(FS, { downloadFile: download, stopDownload: jest.fn() })
  ;(integrationJson as jest.Mock).mockResolvedValue({ reference })
  const result = await prepareWorkspaceMarkdown('![图](/api/task/test/artifacts/frame.png)\n[02:00](/api/task/test/artifacts/source.mp4?t=120)', 'owner')
  expect(result).toBe(`![图](${reference})\n02:00`)
  expect(integrationJson).toHaveBeenCalledTimes(1)
  expect(download.mock.calls[0][0].fromUrl).toContain('/artifacts/frame.png')
  expect(download).toHaveBeenCalledTimes(1)
})
