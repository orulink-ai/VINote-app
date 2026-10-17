package com.vinoteapp

import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.Proxy
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal class BilibiliDownloadError(message: String) : Exception(message)

/** Isolated public-media client. Never receives VINote credentials, cookies or arbitrary headers. */
internal class BilibiliAudioDownloader(private val cancelled: AtomicBoolean, private val progress: (Long, Long) -> Unit) {
  internal var warning: (String) -> Unit = { android.util.Log.w("VINoteBilibili", it); Unit }
  companion object {
    const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    fun viewUrl(query: String) = "https://api.bilibili.com/x/web-interface/view?$query"
    fun playUrl(bvid: String, cid: Long) = "https://api.bilibili.com/x/player/playurl?bvid=$bvid&cid=$cid&fnval=16&fnver=0&qn=16"
  }
  @Volatile private var call: Call? = null
  private val deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5)
  private val client = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).cookieJar(CookieJar.NO_COOKIES)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(60, TimeUnit.SECONDS)
    .dns(object : Dns {
      override fun lookup(hostname: String): List<java.net.InetAddress> {
        check()
        val answers = Dns.SYSTEM.lookup(hostname)
        require(answers.isNotEmpty() && answers.all { BilibiliDownloadPolicy.publicAddress(it) })
        check(); return answers
      }
    }).build()
  fun cancel() { cancelled.set(true); call?.cancel() }
  fun check() {
    if (cancelled.get()) throw BilibiliDownloadError("下载已取消，未提交生成。")
    if (System.nanoTime() >= deadline) throw BilibiliDownloadError("下载已超时，未提交生成；请稍后重试。")
  }
  private fun <T> get(start: String, role: String, consume: (Response) -> T): T {
    var next = start
    repeat(5) { hop ->
      check()
      val url = BilibiliDownloadPolicy.target(next, role)
      val stage = if (role == "api") { if (url.encodedPath == "/x/web-interface/view") "view" else "playurl" } else role
      val label = if (stage == "audio") "音轨" else "来源"
      val request = Request.Builder().url(url).header("User-Agent", USER_AGENT)
        .header("Referer", "https://www.bilibili.com/").header("Accept-Encoding", "identity").get().build()
      val current = client.newCall(request); call = current
      check()
      current.execute().use { response ->
        check()
        if (response.code in listOf(301, 302, 303, 307, 308)) {
          require(hop < 4)
          next = url.resolve(response.header("Location") ?: error("No redirect"))?.toString() ?: error("Invalid redirect")
          BilibiliDownloadPolicy.target(next, role)
          if (role == "short" && next.toHttpUrlOrNull()!!.host in BilibiliDownloadPolicy.pages) {
            @Suppress("UNCHECKED_CAST")
            return BilibiliDownloadPolicy.input(next).toString() as T
          }
        } else {
          if (response.code != 200) {
            // Fixed stage/status/protocol only: never log request/response, exception, URL or remote body.
            warning("stage=$stage http=${response.code} protocol=${response.protocol}")
            if (response.code in listOf(401, 403, 412, 429)) throw BilibiliDownloadError("B站暂时限制读取${label}（HTTP ${response.code}），未提交生成；请稍后重试或导入文件。")
            throw BilibiliDownloadError("暂时无法读取B站${label}（HTTP ${response.code}），未提交生成。")
          }
          require(response.header("Content-Encoding", "identity")!!.equals("identity", true))
          return consume(response)
        }
      }
    }
    error("Redirect limit")
  }
  private fun json(url: String): JSONObject = get(url, "api") { response ->
    val type = response.header("Content-Type", "")!!.substringBefore(';').trim().lowercase()
    require(type in listOf("application/json", "text/json"))
    val body = response.body ?: error("No body")
    val output = ByteArrayOutputStream()
    body.byteStream().use { BilibiliDownloadPolicy.copy(it, output, BilibiliDownloadPolicy.MAX_JSON, body.contentLength(), ::check) {} }
    val root = JSONObject(BilibiliDownloadPolicy.boundedJson(output.toString("UTF-8")))
    val code = root.opt("code")
    if (code is Number && code.toInt() in listOf(-352, -412, -403, -101)) throw BilibiliDownloadError("B站暂时限制读取，未提交生成；请稍后重试或导入文件。")
    require(code is Number && code.toDouble() == 0.0)
    root.getJSONObject("data")
  }
  data class Source(val originalUrl: String, val canonicalUrl: String, val title: String, val bvid: String, val page: Int,
    val aid: String, val cid: String, val duration: Double, val size: Long)
  fun download(original: String, target: File, maximum: Long): Source {
    require(maximum in 1..BilibiliDownloadPolicy.MAX_AUDIO && !target.exists())
    try {
      var input = BilibiliDownloadPolicy.input(original)
      if (input.host == "b23.tv") input = get<String>(input.toString(), "short") { error("Short link did not redirect") }.toHttpUrlOrNull()!!
      val id = input.pathSegments.last()
      val page = input.queryParameter("p")!!.toInt()
      val query = if (id.startsWith("BV")) "bvid=$id" else "aid=${id.drop(2)}"
      val view = json(viewUrl(query))
      val bvid = view.getString("bvid"); val aid = view.getLong("aid")
      require(Regex("BV[0-9A-Za-z]{10}").matches(bvid) && aid > 0 && (if (id.startsWith("BV")) id == bvid else id.drop(2).toLong() == aid))
      val pages = view.getJSONArray("pages"); require(page in 1..pages.length())
      val part = pages.getJSONObject(page - 1); val cid = part.getLong("cid")
      val duration = part.getDouble("duration")
      require(part.getInt("page") == page && cid > 0 && duration.isFinite() && duration > 0 && duration <= 86400)
      val title = (view.getString("title") + if (pages.length() > 1) " — " + part.getString("part") else "").filter { it >= ' ' }.take(300).trim()
      require(title.isNotEmpty())
      val play = json(playUrl(bvid, cid))
      for (flag in listOf("is_preview", "need_vip")) require(!play.has(flag) || play.opt(flag) == false || play.opt(flag) == 0)
      val tracks = play.getJSONObject("dash").getJSONArray("audio")
      val audio = (0 until tracks.length()).map { tracks.getJSONObject(it) }.filter {
        it.optString("mimeType", it.optString("mime_type")) == "audio/mp4" && it.optString("codecs").startsWith("mp4a.") && it.optLong("bandwidth") > 0
      }.minByOrNull { it.getLong("bandwidth") } ?: error("No AAC audio")
      val audioUrl = audio.optString("baseUrl", audio.optString("base_url"))
      val size = get(audioUrl, "audio") { response ->
        require(response.header("Content-Type", "")!!.substringBefore(';').trim().lowercase() in listOf("audio/mp4", "video/mp4", "audio/x-m4a", "application/octet-stream"))
        val body = response.body ?: error("No audio")
        require(target.createNewFile())
        target.outputStream().use { output ->
          val count = body.byteStream().use { BilibiliDownloadPolicy.copy(it, output, maximum, body.contentLength(), ::check) { size -> progress(size, body.contentLength()) } }
          output.fd.sync(); count
        }
      }
      val prefix = ByteArray(12)
      target.inputStream().use { require(it.read(prefix) == 12) }
      require(String(prefix, 4, 4, Charsets.US_ASCII) == "ftyp")
      check()
      return Source(original, "https://www.bilibili.com/video/$bvid?p=$page", title, bvid, page, aid.toString(), cid.toString(), duration, size)
    } catch (error: Exception) {
      target.delete()
      if (error is BilibiliDownloadError) throw error
      check()
      throw BilibiliDownloadError("无法完整保存B站音频，未提交生成；请检查链接和网络，或导入文件。")
    } finally { call = null; client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }
  }
}
