package com.vinoteapp

import okhttp3.*
import okio.ByteString.Companion.toByteString
import java.io.File
import java.net.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private open class Result : ASRSocketResult {
  val done = CountDownLatch(1)
  var category: Int? = null
  var queueBytes: Long? = null
  override fun success(queueBytes: Long?) { this.queueBytes = queueBytes; done.countDown() }
  override fun failure(category: Int) { this.category = category; done.countDown() }
  fun await(): Result { check(done.await(5, TimeUnit.SECONDS)); return this }
}
private class ThrowingResult : Result() {
  override fun success(queueBytes: Long?) { super.success(queueBytes); error("synthetic disposed observer") }
  override fun failure(category: Int) { super.failure(category); error("synthetic disposed observer") }
}
private class Harness(origin: String, base: OkHttpClient) {
  val events = LinkedBlockingQueue<Pair<String, Int?>>()
  val core = ASRSocketCore(origin, base) { _, type, category, _ -> events.put(type to category) }
  fun event(type: String): Pair<String, Int?> {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    val observed = mutableListOf<Pair<String, Int?>>()
    while (System.nanoTime() < deadline) {
      val next = events.poll(100, TimeUnit.MILLISECONDS) ?: continue
      if (next.first == type) return next
      observed.add(next)
    }
    error("Missing safe event $type; observed=$observed")
  }
  fun connect(origin: String) {
    val result = Result(); core.connect("synthetic", "$origin/v1/asr/transcriptions", "synthetic-only", 6402, result)
    check(result.await().category == null)
  }
  fun start() {
    val result = Result(); core.enqueue("synthetic", "{\"type\":\"session.start\",\"model\":\"frozen-synthetic\"}", null, result)
    check(result.await().category == null)
  }
  fun close() {
    val result = Result(); core.close("synthetic", result); check(result.await().category == null); core.invalidate()
  }
  // Test-only reflection; no production arbitrary-origin or socket mutation hook.
  fun socket(): WebSocket {
    val field = core.javaClass.getDeclaredField("active").apply { isAccessible = true }
    val session = field.get(core)
    return session.javaClass.getDeclaredField("socket").apply { isAccessible = true }.get(session) as WebSocket
  }
}

/** Executes the actual production core with real OkHttp TCP/WS, synthetic token, loopback only. */
fun main(args: Array<String>) {
  val origin = args[0]; require(origin.startsWith("ws://127.0.0.1:"))
  val frames = File(args[1]).readLines().associate {
    val fields = it.split('\t'); fields[0].toInt() to java.util.Base64.getDecoder().decode(fields[1])
  }
  val base = OkHttpClient.Builder().proxy(Proxy.NO_PROXY).build()
  val settings = asrHttpClient(base)
  check(!settings.retryOnConnectionFailure && !settings.followRedirects && !settings.followSslRedirects && settings.pingIntervalMillis == 0)

  val normal = Harness(origin, base)
  normal.connect(origin); normal.event("open"); normal.start()
  for (key in listOf(-1, -2)) {
    val result = Result(); normal.core.enqueue("synthetic", null, frames.getValue(key), result)
    check(result.await().category == null && result.queueBytes!! <= 65536)
  }
  check(normal.events.poll(100, TimeUnit.MILLISECONDS) == null) // Stub delays final after LAST.
  normal.event("message")
  check(normal.event("peerClosing").second == 1000)
  check(normal.events.none { it.first == "error" })
  normal.close()

  val slow = Harness(origin, base)
  slow.connect(origin); slow.event("open"); slow.start()
  // Force a real OkHttp writer backlog against a non-reading TCP peer, not a fake queue.
  val slowSocket = slow.socket()
  check(slowSocket.send(ByteArray(8 * 1024 * 1024).toByteString()))
  check(slowSocket.queueSize() > ASRTransportPolicy.QUEUE_LIMIT)
  val blocked = Result(); slow.core.enqueue("synthetic", null, frames.getValue(-1), blocked)
  check(!blocked.done.await(100, TimeUnit.MILLISECONDS))
  check(blocked.await().category == null && blocked.queueBytes!! <= 65536)
  slow.close()

  val refused = Harness(origin, base)
  refused.connect(origin); refused.event("open"); refused.start()
  val socket = refused.socket()
  check(socket.close(1000, null)) // Real OkHttp now rejects subsequent enqueue, before peer replies.
  val failed = ThrowingResult(); refused.core.enqueue("synthetic", null, frames.getValue(-1), failed)
  check(failed.await().category == ASRTransportPolicy.SEND_REJECTED)
  check(refused.event("error").second == ASRTransportPolicy.SEND_REJECTED)
  refused.close()

  val disconnected = Harness(origin, base)
  disconnected.connect(origin); disconnected.event("open")
  check(disconnected.event("error").second in listOf(0, 4, 5, 9)); disconnected.close()

  val cancelled = Harness(origin, base)
  cancelled.connect(origin); cancelled.event("open"); cancelled.close()
  Thread.sleep(250)
  check(cancelled.events.none { it.first == "message" || it.first == "error" })

  val redirect = Harness(origin, base)
  redirect.connect(origin)
  redirect.event("error"); redirect.close() // HTTP302 cannot follow to another authorized request.

  val reused = Harness(origin, base)
  val connected = ThrowingResult()
  reused.core.connect("synthetic", "$origin/v1/asr/transcriptions", "synthetic-only", 6402, connected)
  check(connected.await().category == null); reused.event("open")
  val startObserver = ThrowingResult()
  reused.core.enqueue("synthetic", "{\"type\":\"session.start\",\"model\":\"frozen-synthetic\"}", null, startObserver)
  check(startObserver.await().category == null)
  check(reused.socket().send(ByteArray(8 * 1024 * 1024).toByteString()))
  val pendingObserver = ThrowingResult()
  reused.core.enqueue("synthetic", null, frames.getValue(-1), pendingObserver)
  check(!pendingObserver.done.await(100, TimeUnit.MILLISECONDS))
  val closeObserver = ThrowingResult(); reused.core.close("synthetic", closeObserver)
  check(pendingObserver.await().category == 0)
  check(closeObserver.await().category == null)
  // Same production core, after disposal-throwing pending and close callbacks.
  reused.connect(origin); reused.event("open"); reused.close()

  // Wrong Origin rejected before any connection, even by the pure production core.
  val wrong = Harness("https://fixed.invalid", base)
  val rejected = Result(); wrong.core.connect("synthetic", "$origin/v1/asr/transcriptions", "synthetic-only", 2, rejected)
  check(rejected.await().category == 10); wrong.core.invalidate()

  base.dispatcher.executorService.shutdown(); base.connectionPool.evictAll()
  println("PASS real production core + OkHttp/local WS: JS frames, final/close, real backpressure/send=false, disconnect/cancel, redirect/Origin, throwing observers and same-core reconnect")
}
