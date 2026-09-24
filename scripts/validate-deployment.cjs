const { isIP } = require('node:net')
function publicHost(host) {
  host = host.toLowerCase().replace(/\.$/, '')
  return !isIP(host.replace(/^\[|\]$/g, '')) && host.includes('.') &&
    !/(^|\.)(localhost|local|internal|test|invalid|example|home\.arpa)$/.test(host)
}
function validateDeployment(config) {
  if (!['lan', 'public'].includes(config.channel)) throw new Error('未知部署通道')
  for (const key of ['apiBaseUrl', 'authBaseUrl']) {
    const url = new URL(config[key])
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${key} 必须是无凭证的服务 Origin`)
    if (key === 'authBaseUrl' && url.protocol !== 'https:') throw new Error('账号入口必须使用 HTTPS')
    if (config.channel === 'public' && (url.protocol !== 'https:' || !publicHost(url.hostname))) throw new Error('公网包必须配置 HTTPS 公网域名（不接受 IP 或保留域名）')
  }
  if (typeof config.accountProxyHost !== 'string' || !/^[a-zA-Z0-9.-]*$/.test(config.accountProxyHost)) throw new Error('代理主机无效')
  if (!Number.isInteger(config.accountProxyPort) || config.accountProxyPort < 1 || config.accountProxyPort > 65535) throw new Error('代理端口无效')
  if (config.channel === 'public' && config.accountProxyHost) throw new Error('公网包不能依赖内网账号代理')
  return config
}
module.exports = { validateDeployment }
if (require.main === module) {
  const config = validateDeployment(require('../config/deployment.json'))
  console.log(`部署配置检查通过：${config.channel}（不代表网络连通性已验证）`)
}
