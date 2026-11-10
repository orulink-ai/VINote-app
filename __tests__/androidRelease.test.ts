import { parseAndroidRelease, compareVersions, checkAndroidRelease } from '../src/lib/androidRelease'

describe('Android release metadata', () => {
  it('compares numeric versions correctly', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('0.1.4', '0.1.4')).toBe(0)
    expect(compareVersions('0.1.3', '0.1.4')).toBe(-1)
  })
  it('only accepts published stable releases with a public APK from the expected repository', () => {
    const input = { tag_name: 'v0.1.5', draft: false, prerelease: false, body: '修复转写', html_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/tag/v0.1.5', assets: [{ name: 'VINote_0.1.5.apk', browser_download_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/download/v0.1.5/VINote_0.1.5.apk' }] }
    expect(parseAndroidRelease(input, '0.1.4')).toMatchObject({ version: '0.1.5', notes: '修复转写' })
    expect(parseAndroidRelease({ ...input, prerelease: true }, '0.1.4')).toBeNull()
    expect(parseAndroidRelease({ ...input, assets: [{ name: 'x.apk', browser_download_url: 'https://evil.example/x.apk' }] }, '0.1.4')).toBeNull()
    expect(parseAndroidRelease(input, '0.1.5')).toBeNull()
  })
  it('rejects malformed and nonstandard versions', () => {
    expect(() => compareVersions('1.2.3-beta', '1.2.3')).toThrow()
    expect(parseAndroidRelease({ tag_name: 'v0.2.0', assets: [] }, '0.1.4')).toBeNull()
  })
})

it('reports an empty public release repository without treating it as a network error', async () => {
  const fetcher = jest.fn(async () => ({ status: 404, ok: false })) as unknown as typeof fetch
  await expect(checkAndroidRelease('0.1.4', fetcher)).resolves.toBeNull()
})
it('reports an actual service failure to the caller', async () => {
  const fetcher = jest.fn(async () => ({ status: 503, ok: false })) as unknown as typeof fetch
  await expect(checkAndroidRelease('0.1.4', fetcher)).rejects.toThrow('更新服务暂不可用')
})
it('uses the public manifest when the GitHub API rate limits requests', async () => {
  const release = { tag_name: 'v0.1.6', draft: false, prerelease: false, body: '', html_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/tag/v0.1.6', assets: [{ name: 'VINote.apk', browser_download_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/download/v0.1.6/VINote.apk' }] }
  const fetcher = jest.fn().mockResolvedValueOnce({ status: 403, ok: false }).mockResolvedValueOnce({ status: 200, ok: true, json: async () => release })
  expect((await checkAndroidRelease('0.1.5', fetcher))?.version).toBe('0.1.6')
  expect(fetcher.mock.calls[1][0]).toBe('https://raw.githubusercontent.com/vilab-orulink/Vinote-app-public/main/latest.json')
})
