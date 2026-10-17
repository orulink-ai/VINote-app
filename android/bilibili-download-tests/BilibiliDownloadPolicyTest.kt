package com.vinoteapp

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress

private fun denied(action: () -> Unit) { check(runCatching(action).isFailure) }
fun main() {
  val source = "https://www.bilibili.com/video/BV1234567890?p=2&share_source=copy"
  check(BilibiliDownloadPolicy.input(source).toString() == "https://www.bilibili.com/video/BV1234567890?p=2")
  check(BilibiliDownloadPolicy.input("https://b23.tv/example").host == "b23.tv")
  for (url in listOf("http://b23.tv/example", "https://u:p@b23.tv/example", "https://b23.tv:444/example", "https://b23.tv/example?p=1", "https://www.bilibili.com/video/BV1234567890?p=0", "https://www.bilibili.com/video/BV1234567890?p=1&p=2", "https://www.bilibili.com/a/../video/BV1234567890", "https://www.bilibili.com/video/%42V1234567890", "https://bilibili.com.evil.test/video/BV1234567890")) denied { BilibiliDownloadPolicy.input(url) }
  BilibiliDownloadPolicy.target("https://api.bilibili.com/x/player/playurl?cid=1", "api")
  BilibiliDownloadPolicy.target("https://audio.bilivideo.com/up/audio.m4a?opaque=synthetic", "audio")
  for (url in listOf("https://bilivideo.com/a", "https://audio.bilivideo.com.evil.test/a", "http://audio.bilivideo.com/a", "https://127.0.0.1/a")) denied { BilibiliDownloadPolicy.target(url, "audio") }
  denied { BilibiliDownloadPolicy.target("https://api.bilibili.com/x/other", "api") }
  for (bytes in listOf(byteArrayOf(127,0,0,1), byteArrayOf(10,0,0,1), byteArrayOf(100,64,0,1), byteArrayOf(192.toByte(),0,2,1), byteArrayOf(198.toByte(),18,0,1))) check(!BilibiliDownloadPolicy.publicAddress(InetAddress.getByAddress(bytes)))
  check(BilibiliDownloadPolicy.publicAddress(InetAddress.getByAddress(byteArrayOf(8,8,8,8))))
  val original = ByteArray(20001) { (it % 127).toByte() }
  val output = ByteArrayOutputStream()
  check(BilibiliDownloadPolicy.copy(ByteArrayInputStream(original), output, 20001, 20001, {}, {}) == 20001L)
  check(output.toByteArray().contentEquals(original))
  val limited = ByteArrayOutputStream()
  denied { BilibiliDownloadPolicy.copy(ByteArrayInputStream(original), limited, 10000, -1, {}, {}) }
  check(limited.size() <= 10000)
  denied { BilibiliDownloadPolicy.copy(ByteArrayInputStream(original), ByteArrayOutputStream(), 999, 20001, {}, {}) }
  denied { BilibiliDownloadPolicy.copy(ByteArrayInputStream(original), ByteArrayOutputStream(), 30000, 20002, {}, {}) }
  var guards = 0
  val cancelled = ByteArrayOutputStream()
  denied { BilibiliDownloadPolicy.copy(ByteArrayInputStream(original), cancelled, 30000, -1, { guards++; check(guards < 3) }, {}) }
  check(cancelled.size() <= 8192)
  BilibiliDownloadPolicy.boundedJson("{\"literal\":\"[\\\"{\"}")
  denied { BilibiliDownloadPolicy.boundedJson("[".repeat(33) + "]".repeat(33)) }
  println("Bilibili native policy: URL/role/DNS/byte cap/short read/cancel/JSON bounds passed; no network")
}
