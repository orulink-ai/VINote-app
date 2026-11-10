const REPOSITORY = 'https://github.com/vilab-orulink/Vinote-app-public'
const RELEASE_API = 'https://api.github.com/repos/vilab-orulink/Vinote-app-public/releases/latest'
const RELEASE_MANIFEST = 'https://raw.githubusercontent.com/vilab-orulink/Vinote-app-public/main/latest.json'

/** The public manifest avoids GitHub API limits shared by users behind one IP. */
export async function requestAndroidRelease(request: typeof fetch, signal: AbortSignal): Promise<Response> {
  const options: RequestInit = { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', signal }
  const response = await request(RELEASE_API, options)
  return response.status === 403 || response.status === 429 ? request(RELEASE_MANIFEST, options) : response
}

export type AndroidRelease = { version: string; notes: string; pageUrl: string; apkUrl: string }

export async function checkAndroidRelease(currentVersion: string, request: typeof fetch = fetch): Promise<AndroidRelease | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await requestAndroidRelease(request, controller.signal)
    if (response.status === 404) return null
    if (!response.ok) throw new Error('更新服务暂不可用，请稍后重试')
    return parseAndroidRelease(await response.json(), currentVersion)
  } finally { clearTimeout(timer) }
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('版本号格式无效')
    const parts = value.split('.').map(Number)
    if (!parts.every(Number.isSafeInteger)) throw new Error('版本号格式无效')
    return parts
  }
  const left = parse(a), right = parse(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function parseAndroidRelease(value: unknown, currentVersion: string): AndroidRelease | null {
  if (!value || typeof value !== 'object') return null
  const release = value as Record<string, unknown>
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') return null
  const tag = release.tag_name, version = tag.startsWith('v') ? tag.slice(1) : tag
  try { if (compareVersions(version, currentVersion) <= 0) return null } catch { return null }
  const pageUrl = `${REPOSITORY}/releases/tag/${tag}`
  if (release.html_url !== pageUrl || !Array.isArray(release.assets)) return null
  const downloadPrefix = `${REPOSITORY}/releases/download/${tag}/`
  const apk = release.assets.find((item: unknown) => {
    if (!item || typeof item !== 'object') return false
    const asset = item as Record<string, unknown>
    return typeof asset.name === 'string' && /^[A-Za-z0-9._-]+\.apk$/i.test(asset.name) &&
      asset.browser_download_url === `${downloadPrefix}${asset.name}`
  }) as { browser_download_url: string } | undefined
  return apk ? { version, notes: typeof release.body === 'string' ? release.body : '', pageUrl, apkUrl: apk.browser_download_url } : null
}
