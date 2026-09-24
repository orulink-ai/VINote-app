package com.vinoteapp

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI

/** 复用部署服务的账号网络出口；HTTPS CONNECT 保留端到端证书校验。 */
class AccountProxySelector : ProxySelector() {
  override fun select(uri: URI): List<Proxy> =
    if (BuildConfig.ACCOUNT_PROXY_HOST.isNotEmpty() && uri.scheme == "https" && uri.host == "jzwidvczdjbkontidwpy.supabase.co") {
      listOf(Proxy(Proxy.Type.HTTP, InetSocketAddress(BuildConfig.ACCOUNT_PROXY_HOST, BuildConfig.ACCOUNT_PROXY_PORT)))
    } else {
      listOf(Proxy.NO_PROXY)
    }

  override fun connectFailed(uri: URI, address: SocketAddress, failure: IOException) {
    // 交由请求层显示失败，不记录凭证，不切换到不安全的认证端点。
  }
}
