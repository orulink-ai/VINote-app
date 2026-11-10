import { validateApkAsset, verifyApkHash } from '../src/lib/apkUpdatePolicy'
const hash = 'a'.repeat(64)
const asset = { name: 'VINote_0.1.5.apk', size: 12345, digest: `sha256:${hash}`, browser_download_url: 'https://github.com/vilab-orulink/Vinote-app-public/releases/download/v0.1.5/VINote_0.1.5.apk' }
test('accepts a bounded APK from the exact stable release and verifies its digest', () => {
  expect(validateApkAsset(asset, 'v0.1.5')).toEqual({ url: asset.browser_download_url, bytes: 12345, sha256: hash })
  expect(verifyApkHash(hash, hash.toUpperCase())).toBe(true)
  expect(verifyApkHash(hash, 'b'.repeat(64))).toBe(false)
})
test('rejects mismatched origin, release, name, missing digest and oversized downloads', () => {
  for (const value of [{ ...asset, browser_download_url: 'https://example.com/file.apk' }, { ...asset, browser_download_url: asset.browser_download_url.replace('v0.1.5/', 'v0.1.4/') }, { ...asset, name: '../bad.apk' }, { ...asset, digest: null }, { ...asset, size: 1024 * 1024 * 1024 + 1 }]) expect(validateApkAsset(value, 'v0.1.5')).toBeNull()
})
