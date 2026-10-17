package com.vinoteapp

import java.io.EOFException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.net.ssl.SSLException
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** Closed numeric schema. Never transport exception messages, hosts, paths or credentials. */
internal object ASRTransportPolicy {
  const val UNKNOWN = 0
  const val SEND_REJECTED = 1
  const val BACKPRESSURE_TIMEOUT = 2
  const val TIMEOUT = 3
  const val SOCKET = 4
  const val EOF = 5
  const val TLS = 6
  const val CONNECT = 7
  const val DNS = 8
  const val IO = 9
  const val PROTOCOL = 10
  const val QUEUE_LIMIT = 65536L
  const val WAIT_MS = 10000L
  const val MESSAGE_LIMIT = 8 * 1024 * 1024

  /** UTF-8 size without allocating another multi-megabyte buffer; -1 exceeds the cap. */
  fun messageBytes(text: String): Int {
    if (text.length > MESSAGE_LIMIT) return -1
    var bytes = 0; var i = 0
    while (i < text.length) {
      val c = text[i].code
      bytes += when {
        c <= 0x7f -> 1
        c <= 0x7ff -> 2
        c in 0xd800..0xdbff && i + 1 < text.length && text[i + 1].code in 0xdc00..0xdfff -> { i++; 4 }
        c in 0xd800..0xdfff -> 1 // JVM UTF-8 replaces an unpaired surrogate with '?'.
        else -> 3
      }
      if (bytes > MESSAGE_LIMIT) return -1
      i++
    }
    return bytes
  }

  // 0: may enqueue, -1: wait without sending, 2: terminate without replay.
  fun admission(queueBytes: Long, frameBytes: Int, now: Long, deadline: Long): Int =
    if (queueBytes + frameBytes <= QUEUE_LIMIT) 0 else if (now >= deadline) BACKPRESSURE_TIMEOUT else -1

  fun classify(error: Throwable): Int = when (error) {
    is SocketTimeoutException -> TIMEOUT
    is SSLException -> TLS
    is UnknownHostException -> DNS
    is ConnectException -> CONNECT
    is EOFException -> EOF
    // SocketException is broader than ECONNRESET; the category deliberately does not claim errno.
    is SocketException -> SOCKET
    is java.io.IOException -> IO
    else -> UNKNOWN
  }
}

internal fun asrHttpClient(base: okhttp3.OkHttpClient): okhttp3.OkHttpClient = base.newBuilder()
  .retryOnConnectionFailure(false)
  .followRedirects(false).followSslRedirects(false)
  .connectTimeout(10, TimeUnit.SECONDS).writeTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS)
  .pingInterval(0, TimeUnit.SECONDS) // Provider finalization need not poll client Ping frames.
  .build()

/** State advances only after OkHttp returns true. The rejected frame is never retried. */
internal class ASRFrameCoverage(private val expectedBytes: Long) {
  var bytes: Long = 0; private set
  var frames: Int = 0; private set
  init { require(expectedBytes > 0 && expectedBytes % 2L == 0L) }

  fun valid(frame: ByteArray): Boolean {
    if (frame.size < 22 || frame.size > 6420 || bytes >= expectedBytes) return false
    val b = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN)
    val size = frame.size - 20
    val flags = frame[6].toInt() and 255
    val last = bytes + size == expectedBytes
    return frame[0] == 86.toByte() && frame[1] == 76.toByte() && frame[2] == 65.toByte() && frame[3] == 50.toByte() &&
      frame[4] == 2.toByte() && frame[5] == 1.toByte() && frame[7] == 0.toByte() &&
      b.getInt(8) == frames && b.getInt(12) == 0 && b.getInt(16) == size &&
      size % 2 == 0 && size.toLong() == minOf(6400L, expectedBytes - bytes) &&
      flags == (if (frames == 0) 1 else 0) + (if (last) 2 else 0)
  }

  fun enqueue(frame: ByteArray, send: () -> Boolean): Boolean {
    check(valid(frame))
    if (!send()) return false
    bytes += frame.size - 20; frames++
    return true
  }
}

/** Posting races with teardown; a late callback never escapes as an executor rejection. */
internal class ASRSafePoster(private val worker: ScheduledExecutorService) {
  @Volatile var invalidated = false; private set
  fun invalidate() { invalidated = true }
  fun post(cleanup: Boolean = false, action: () -> Unit): Boolean {
    if (invalidated && !cleanup) return false
    return try {
      worker.execute { if (!invalidated || cleanup) action() }
      true
    } catch (_: RejectedExecutionException) { false }
  }
  fun later(action: () -> Unit): Boolean {
    if (invalidated) return false
    return try {
      worker.schedule({ if (!invalidated) action() }, 20, TimeUnit.MILLISECONDS)
      true
    } catch (_: RejectedExecutionException) { false }
  }
}
