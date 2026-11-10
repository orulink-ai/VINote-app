import { parseAndroidRelease, requestAndroidRelease, type AndroidRelease } from './androidRelease'
import { validateApkAsset, type ApkUpdateAsset } from './apkUpdatePolicy'

export type InstallableAndroidRelease = AndroidRelease & { asset: ApkUpdateAsset }

export async function checkInstallableAndroidRelease(currentVersion: string, request: typeof fetch = fetch): Promise<InstallableAndroidRelease | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await requestAndroidRelease(request, controller.signal)
    if (response.status === 404) return null
    if (!response.ok) throw new Error('更新服务暂不可用，请稍后重试')
    return installableAndroidRelease(await response.json(), currentVersion)
  } finally { clearTimeout(timer) }
}

/** A release may be viewable without having enough integrity metadata for in-app installation. */
export function installableAndroidRelease(value: unknown, currentVersion: string): InstallableAndroidRelease | null {
  const release = parseAndroidRelease(value, currentVersion)
  if (!release || !value || typeof value !== 'object') return null
  const raw = value as { tag_name?: unknown; assets?: unknown }
  if (typeof raw.tag_name !== 'string' || !Array.isArray(raw.assets)) return null
  const asset = raw.assets.map(item => validateApkAsset(item, raw.tag_name as string)).find(item => item && item.url === release.apkUrl)
  return asset ? { ...release, asset } : null
}
