const RELEASE_ROOT = 'https://github.com/vilab-orulink/Vinote-app-public/releases/download/'
const MAX_APK_BYTES = 1024 * 1024 * 1024

export type ApkUpdateAsset = { url: string; bytes: number; sha256: string; apiUrl?: string }

/** Only exact official release assets with a bounded size and published digest are installable. */
export function validateApkAsset(value: unknown, tag: string): ApkUpdateAsset | null {
  if (!value || typeof value !== 'object' || !/^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) return null
  const asset = value as Record<string, unknown>
  if (typeof asset.name !== 'string' || !/^[a-z0-9._-]+\.apk$/i.test(asset.name) ||
      asset.browser_download_url !== `${RELEASE_ROOT}${tag}/${asset.name}` ||
      typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_APK_BYTES ||
      typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return null
  const apiUrl = typeof asset.id === 'number' && Number.isSafeInteger(asset.id) && asset.id > 0
    ? `https://api.github.com/repos/vilab-orulink/Vinote-app-public/releases/assets/${asset.id}` : undefined
  return { url: asset.browser_download_url as string, bytes: asset.size, sha256: asset.digest.slice(7).toLowerCase(), apiUrl }
}

export function verifyApkHash(expected: string, actual: string) {
  return /^[a-f0-9]{64}$/i.test(expected) && /^[a-f0-9]{64}$/i.test(actual) && expected.toLowerCase() === actual.toLowerCase()
}
