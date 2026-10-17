// Shared by the packager and RN runtime; no environment or network lookup.
function validateGenerationBaseUrl(config, { required = false } = {}) {
  const value = config.generationBaseUrl
  if (value === undefined || value === '') {
    if (required) throw new Error('Release 必须显式配置 generationBaseUrl 内容服务')
    return ''
  }
  if (typeof value !== 'string' || value !== value.trim() || /[\\?#%]/.test(value)) throw new Error('generationBaseUrl 必须是无凭证的内容服务地址')
  const url = new URL(value)
  const rawPath = value.replace(/^https?:\/\/[^/]+/, '')
  if (url.protocol !== 'https:' || url.username || url.password ||
      !/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(rawPath || '/') ||
      !url.hostname.includes('.') || /[:\[\]]/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) ||
      /(^|\.)(localhost|local|internal|test|invalid|example|home\.arpa)\.?$/i.test(url.hostname)) {
    throw new Error('generationBaseUrl 必须使用 HTTPS 公网域名和规范路径')
  }
  const base = url.href.replace(/\/+$/, '')
  // An explicitly configured content runtime may share the integration prefix.
  // Its role is established by authenticated capabilities, never by this URL.
  for (const key of ['apiBaseUrl', 'authBaseUrl']) {
    if (!config[key]) continue
    const other = new URL(config[key]).href.replace(/\/+$/, '')
    if (base === other || (key !== 'authBaseUrl' && base.startsWith(other + '/'))) {
      throw new Error('generationBaseUrl 不得借用模型、账号或飞书集成服务入口')
    }
  }
  return base
}

function resolveGenerationBaseUrl(config, development) {
  if (development) return 'http://127.0.0.1:8900'
  try { return validateGenerationBaseUrl(config) } catch { return '' }
}

module.exports = { validateGenerationBaseUrl, resolveGenerationBaseUrl }
