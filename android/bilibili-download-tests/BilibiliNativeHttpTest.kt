package com.vinoteapp

import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import java.net.Proxy
import java.util.concurrent.atomic.AtomicBoolean

/** Executes the actual private hop loop with a synthetic interceptor; zero sockets/DNS. */
fun main() {
  val warnings = mutableListOf<String>()
  fun scenario(respond: (Request, Int) -> Response, action: (BilibiliAudioDownloader, MutableList<Request>) -> Unit) {
    warnings.clear()
    val downloader = BilibiliAudioDownloader(AtomicBoolean(false)) { _, _ -> }
    downloader.warning = { warnings.add(it) }
    val field = downloader.javaClass.getDeclaredField("client").apply { isAccessible = true }
    val original = field.get(downloader) as OkHttpClient
    check(original.proxy == Proxy.NO_PROXY && !original.followRedirects && !original.followSslRedirects && !original.retryOnConnectionFailure)
    check(original.cookieJar === CookieJar.NO_COOKIES && original.interceptors.isEmpty())
    val seen = mutableListOf<Request>()
    val fake = original.newBuilder().addInterceptor { chain ->
      val request = chain.request(); seen.add(request)
      check(request.header("Authorization") == null && request.header("Cookie") == null)
      check(request.header("Referer") == "https://www.bilibili.com/")
      check(request.header("User-Agent") == "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
      check(request.header("Accept-Encoding") == "identity")
      respond(request, seen.size)
    }.build()
    field.set(downloader, fake)
    try { action(downloader, seen) } finally { fake.connectionPool.evictAll(); fake.dispatcher.executorService.shutdown() }
  }
  fun response(request: Request, code: Int, redirect: String? = null) = Response.Builder().request(request).protocol(Protocol.HTTP_2).code(code).message("synthetic")
    .body("synthetic".toResponseBody()).apply { if (redirect != null) header("Location", redirect) }.build()
  fun fetch(downloader: BilibiliAudioDownloader, url: String = "https://audio.bilivideo.com/a.m4a?opaque=synthetic", role: String = "audio"): Any? {
    val method = downloader.javaClass.declaredMethods.first { it.name == "get" }.apply { isAccessible = true }
    return method.invoke(downloader, url, role, { response: Response -> response.code })
  }
  scenario({ request, count -> response(request, if (count == 1) 302 else 200, if (count == 1) "https://second.bilivideo.cn/audio.m4a" else null) }) { downloader, seen ->
    check(fetch(downloader) == 200 && seen.size == 2)
  }
  scenario({ request, _ -> response(request, 302, "https://127.0.0.1/private") }) { downloader, seen ->
    check(runCatching { fetch(downloader) }.isFailure && seen.size == 1)
  }
  scenario({ request, _ -> response(request, 412) }) { downloader, seen ->
    val error = runCatching { fetch(downloader) }.exceptionOrNull()!!.cause!!
    check(error is BilibiliDownloadError && error.message!!.contains("HTTP 412") && !error.message!!.contains("opaque"))
    check(seen.size == 1)
    check(warnings == listOf("stage=audio http=412 protocol=h2"))
    check(error.message!!.contains("音轨"))
  }
  val bvid = "BV12iFezdEZS"
  check(BilibiliAudioDownloader.viewUrl("bvid=$bvid") == "https://api.bilibili.com/x/web-interface/view?bvid=$bvid")
  check(BilibiliAudioDownloader.viewUrl("aid=123") == "https://api.bilibili.com/x/web-interface/view?aid=123")
  check(BilibiliAudioDownloader.playUrl(bvid, 123L) == "https://api.bilibili.com/x/player/playurl?bvid=$bvid&cid=123&fnval=16&fnver=0&qn=16")
  for ((stage, url, role) in listOf(
    Triple("short", "https://b23.tv/example", "short"),
    Triple("view", BilibiliAudioDownloader.viewUrl("bvid=$bvid"), "api"),
    Triple("playurl", BilibiliAudioDownloader.playUrl(bvid, 123L), "api"),
    Triple("audio", "https://audio.bilivideo.com/a.m4a?opaque=secret", "audio"))) {
    scenario({ request, _ -> response(request, 403) }) { downloader, seen ->
      val error = runCatching { fetch(downloader, url, role) }.exceptionOrNull()!!.cause!!
      check(error is BilibiliDownloadError && error.message!!.contains("HTTP 403"))
      check(seen.size == 1 && warnings == listOf("stage=$stage http=403 protocol=h2"))
      check(error.message!!.contains(if (stage == "audio") "音轨" else "来源"))
    }
  }
  scenario({ request, _ -> response(request, 200) }) { downloader, seen ->
    downloader.cancel()
    check(runCatching { fetch(downloader) }.isFailure && seen.isEmpty())
  }
  println("Actual Bili hop loop: dedicated client, no credentials, allowed/blocked redirects, HTTP412 no replay passed (synthetic HTTP2, no network)")
}
