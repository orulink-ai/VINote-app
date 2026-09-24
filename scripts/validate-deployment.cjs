const config = require('../config/deployment.json')
const privateHost = host => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) || host.endsWith('.local')
for (const key of ['apiBaseUrl', 'authBaseUrl']) {
  const url = new URL(config[key])
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${key} 必须是无凭证的服务 Origin`)
  if (config.channel === 'public' && (url.protocol !== 'https:' || privateHost(url.hostname))) throw new Error('公网包必须配置可访问的 HTTPS 公网域名')
}
if (config.channel === 'public' && config.accountProxyHost) throw new Error('公网包不能依赖内网账号代理，请配置可公开访问的认证入口')
if (!['lan', 'public'].includes(config.channel)) throw new Error('未知部署通道')
console.log(`部署配置检查通过：${config.channel}（不代表网络连通性已验证）`)
