import { checkInstallableAndroidRelease, installableAndroidRelease } from '../src/lib/installableAndroidRelease'

const asset = { name: 'VINote.apk', browser_download_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/download/v1.2.3/VINote.apk', size: 128, digest: `sha256:${'a'.repeat(64)}` }
const release = { draft: false, prerelease: false, tag_name: 'v1.2.3', html_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/tag/v1.2.3', body: '修复', assets: [asset] }
test('requires an official release asset with size and hash for in-app installation', () => {
  expect(installableAndroidRelease(release, '1.2.2')?.asset.sha256).toBe('a'.repeat(64))
  expect(installableAndroidRelease({ ...release, assets: [{ ...asset, digest: null }] }, '1.2.2')).toBeNull()
  expect(installableAndroidRelease(release, '1.2.3')).toBeNull()
})
test('reads the public repository release and rejects incomplete update metadata', async () => {
  const request = jest.fn(async () => ({ status: 200, ok: true, json: async () => release })) as unknown as typeof fetch
  expect((await checkInstallableAndroidRelease('1.2.2', request))?.version).toBe('1.2.3')
  expect(request).toHaveBeenCalledWith('https://api.github.com/repos/vilab-orulink/Vinote-app-public/releases/latest', expect.any(Object))
})
