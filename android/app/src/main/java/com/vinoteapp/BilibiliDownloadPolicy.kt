package com.vinoteapp

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.URI

/** Pure policy used by the actual native downloader and the offline JVM tests. */
internal object BilibiliDownloadPolicy {
  const val MAX_AUDIO = 128L * 1024 * 1024
  const val MAX_JSON = 2L * 1024 * 1024
  val pages = setOf("www.bilibili.com", "m.bilibili.com", "bilibili.com")
  private fun base(value: String): HttpUrl {
    require(value.length <= 8192 && value.none { it <= ' ' || it == '\\' })
    val url = value.toHttpUrlOrNull() ?: error("Invalid URL")
    require(url.isHttps && url.port == 443 && url.username.isEmpty() && url.password.isEmpty() && url.fragment == null)
    return url
  }
  fun input(value: String): HttpUrl {
    val url = base(value)
    require(URI(value).rawPath == url.encodedPath)
    if (url.host == "b23.tv") {
      require(Regex("/[A-Za-z0-9]{1,32}/?").matches(url.encodedPath) && url.queryParameterValues("p").isEmpty())
      return "https://b23.tv/${url.encodedPath.trim('/')}".toHttpUrlOrNull()!!
    }
    require(url.host in pages && Regex("/video/(BV[0-9A-Za-z]{10}|av[1-9][0-9]{0,19})/?").matches(url.encodedPath))
    val parts = url.queryParameterValues("p")
    require(parts.size <= 1)
    val page = parts.firstOrNull() ?: "1"
    require(Regex("[1-9][0-9]{0,3}").matches(page))
    return "https://www.bilibili.com${url.encodedPath.trimEnd('/')}?p=$page".toHttpUrlOrNull()!!
  }
  fun target(value: String, role: String): HttpUrl {
    val url = base(value)
    when (role) {
      "short" -> input(value)
      "api" -> require(url.host == "api.bilibili.com" && url.encodedPath in setOf("/x/web-interface/view", "/x/player/playurl"))
      "audio" -> require(listOf(".bilivideo.com", ".bilivideo.cn", ".acgvideo.com").any { url.host.endsWith(it) && url.host != it.drop(1) })
      else -> error("Invalid role")
    }
    return url
  }
  fun publicAddress(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
    val b = address.address.map { it.toInt() and 255 }
    if (b.size == 4) return !(b[0] in setOf(0, 10, 127) || b[0] >= 224 ||
      b[0] == 100 && b[1] in 64..127 || b[0] == 169 && b[1] == 254 || b[0] == 172 && b[1] in 16..31 ||
      b[0] == 192 && (b[1] == 168 || b[1] == 0 || b[1] == 88 && b[2] == 99) ||
      b[0] == 198 && (b[1] in 18..19 || b[1] == 51 && b[2] == 100) || b[0] == 203 && b[1] == 0 && b[2] == 113)
    return b.size == 16 && b[0] in 0x20..0x3f && !(b[0] == 0x20 && b[1] == 1 && (b[2] == 0x0d && b[3] == 0xb8 || b[2] == 0))
  }
  fun copy(input: InputStream, output: OutputStream, maximum: Long, expected: Long, guard: () -> Unit, progress: (Long) -> Unit): Long {
    require(maximum > 0 && expected <= maximum)
    val buffer = ByteArray(8192)
    var count = 0L
    while (true) {
      guard()
      val read = input.read(buffer, 0, minOf(buffer.size.toLong(), maximum - count + 1).toInt())
      if (read < 0) break
      guard()
      require(read.toLong() <= maximum - count) { "Byte budget exceeded" }
      output.write(buffer, 0, read); count += read
      progress(count)
    }
    require(count > 0 && (expected < 0 || expected == count)) { "Incomplete download" }
    guard()
    return count
  }
  fun boundedJson(text: String): String {
    var depth = 0; var quoted = false; var escaped = false
    for (char in text) {
      if (quoted) {
        if (escaped) escaped = false else if (char == '\\') escaped = true else if (char == '"') quoted = false
      } else if (char == '"') quoted = true
      else if (char == '{' || char == '[') { depth++; require(depth <= 32) }
      else if (char == '}' || char == ']') { depth--; require(depth >= 0) }
    }
    require(depth == 0 && !quoted)
    return text
  }
}
