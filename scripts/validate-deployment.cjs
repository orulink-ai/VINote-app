const { isIP } = require('node:net')
const { validateGenerationBaseUrl } = require('../src/config/generationService')
function publicHost(host) {
  host = host.toLowerCase().replace(/\.$/, '')
  return !isIP(host.replace(/^\[|\]$/g, '')) && host.includes('.') &&
    !/(^|\.)(localhost|local|internal|test|invalid|example|home\.arpa)$/.test(host)
}
function validateDeployment(config, { requireGeneration = false, requireIntegration = false } = {}) {
  if (requireIntegration && (typeof config.integrationBaseUrl !== 'string' || !config.integrationBaseUrl.trim() || config.integrationBaseUrl !== config.integrationBaseUrl.trim())) throw new Error('独立包必须显式配置 integrationBaseUrl 飞书集成服务')
  if (!['lan', 'public'].includes(config.channel)) throw new Error('未知部署通道')
  for (const key of ['apiBaseUrl', 'authBaseUrl', ...(config.integrationBaseUrl ? ['integrationBaseUrl'] : [])]) {
    const url = new URL(config[key])
    const validPath = url.pathname === '/' || (key === 'integrationBaseUrl' && /^\/vinote-api\/?$/.test(url.pathname))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !validPath) throw new Error(`${key} 必须是无凭证的服务地址，集成服务仅允许 /vinote-api 前缀`)
    if (key === 'authBaseUrl' && url.protocol !== 'https:') throw new Error('账号入口必须使用 HTTPS')
    if (config.channel === 'public' && (url.protocol !== 'https:' || !publicHost(url.hostname))) throw new Error('公网包必须配置 HTTPS 公网域名（不接受 IP 或保留域名）')
  }
  if (typeof config.accountProxyHost !== 'string' || !/^[a-zA-Z0-9.-]*$/.test(config.accountProxyHost)) throw new Error('代理主机无效')
  if (!Number.isInteger(config.accountProxyPort) || config.accountProxyPort < 1 || config.accountProxyPort > 65535) throw new Error('代理端口无效')
  if (config.channel === 'public' && config.accountProxyHost) throw new Error('公网包不能依赖内网账号代理')
  validateGenerationBaseUrl(config, { required: requireGeneration })
  return config
}
module.exports = { validateDeployment }
if (require.main === module) {
  if (process.argv.some(arg => ['--require-generation', '--require-integration', '--require-public'].includes(arg))) {
    const config = require('../config/deployment.json')
    if (process.argv.includes('--require-public') && config.channel !== 'public') throw new Error('Release 必须选择 public 通道')
    validateDeployment(config, { requireGeneration: process.argv.includes('--require-generation'), requireIntegration: process.argv.includes('--require-integration') })
  }
  validateDeployment(require('../config/deployment.test.json'))
  validateDeployment(require('../config/deployment.public.json'))
  console.log("测试版和正式版配置检查通过（不代表网络连通性已验证）")
}
