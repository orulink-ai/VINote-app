package com.vinoteapp

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Real production admission/coverage policy; no Android/device/socket/provider calls. */
fun main(args: Array<String>) {
  fun bridge(type: String, number: Int): Map<String, Any> {
    val fields = mutableMapOf<String, Any>()
    writeASREventFields("synthetic", type, number, "SYNTHETIC_SECRET", { k, v -> fields[k] = v }, { k, v -> fields[k] = v })
    return fields
  }
  check(bridge("peerClosing", 1000) == mapOf("id" to "synthetic", "type" to "peerClosing", "code" to 1000))
  check(bridge("error", 3) == mapOf("id" to "synthetic", "type" to "error", "category" to 3))
  check(bridge("peerClosing", 3)["code"] == 1006)
  check(bridge("error", 1000)["category"] == 0)
  val jsFrames = java.io.File(args.single()).readLines().associate { line ->
    val fields = line.split('\t'); fields[0].toInt() to java.util.Base64.getDecoder().decode(fields[1])
  }
  fun frame(sequence: Int, size: Int, flags: Int) = ByteArray(20 + size).also {
    it[0] = 86; it[1] = 76; it[2] = 65; it[3] = 50; it[4] = 2; it[5] = 1; it[6] = flags.toByte()
    ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putInt(8, sequence).putInt(16, size)
  }
  var sends = 0
  val rejected = ASRFrameCoverage(6402)
  check(!rejected.enqueue(frame(0, 6400, 1)) { sends++; false })
  check(sends == 1 && rejected.bytes == 0L && rejected.frames == 0)

  check(ASRTransportPolicy.admission(65536, 6420, 0, 10000) == -1)
  check(ASRTransportPolicy.admission(65536, 6420, 10000, 10000) == 2)
  check(ASRTransportPolicy.admission(65536 - 6420, 6420, 10000, 10000) == 0)
  check(!rejected.valid(frame(0, 6400, 3))) // Premature LAST.
  check(!rejected.valid(frame(1, 6400, 1))) // Out-of-order.

  val coverage = ASRFrameCoverage(44_049_554)
  var lasts = 0
  while (coverage.bytes < 44_049_554) {
    val count = minOf(6400L, 44_049_554 - coverage.bytes).toInt()
    val last = coverage.bytes + count == 44_049_554L
    val flags = (if (coverage.frames == 0) 1 else 0) + (if (last) 2 else 0)
    val realJSFrame = jsFrames[coverage.frames] ?: frame(coverage.frames, count, flags)
    check(coverage.enqueue(realJSFrame) { true })
    if (last) lasts++
  }
  check(coverage.bytes == 44_049_554L && coverage.frames == 6883 && lasts == 1)
  check(!coverage.valid(frame(6882, 4754, 2))) // No LAST replay.

  check(ASRTransportPolicy.classify(java.net.SocketTimeoutException("SYNTHETIC_SECRET")) == 3)
  check(ASRTransportPolicy.classify(java.net.SocketException("SYNTHETIC_SECRET")) == 4)
  check(ASRTransportPolicy.classify(java.io.EOFException("SYNTHETIC_SECRET")) == 5)
  check(ASRTransportPolicy.classify(javax.net.ssl.SSLException("SYNTHETIC_SECRET")) == 6)
  check(ASRTransportPolicy.classify(java.net.ConnectException("SYNTHETIC_SECRET")) == 7)
  check(ASRTransportPolicy.classify(java.net.UnknownHostException("SYNTHETIC_SECRET")) == 8)
  check(ASRTransportPolicy.classify(java.io.IOException("SYNTHETIC_SECRET")) == 9)
  check(ASRTransportPolicy.classify(IllegalArgumentException("SYNTHETIC_SECRET")) == 0)
  check(ASRTransportPolicy.messageBytes("x".repeat(ASRTransportPolicy.MESSAGE_LIMIT)) == ASRTransportPolicy.MESSAGE_LIMIT)
  check(ASRTransportPolicy.messageBytes("x".repeat(ASRTransportPolicy.MESSAGE_LIMIT + 1)) == -1)
  check(ASRTransportPolicy.messageBytes("中".repeat(ASRTransportPolicy.MESSAGE_LIMIT / 3 + 1)) == -1)
  check(ASRTransportPolicy.messageBytes("😀") == 4)

  val worker = java.util.concurrent.Executors.newSingleThreadScheduledExecutor()
  val poster = ASRSafePoster(worker)
  val cleaned = java.util.concurrent.CountDownLatch(1)
  var callbacks = 0
  check(poster.post { callbacks++ })
  poster.invalidate()
  check(!poster.post { error("late non-cleanup callback") })
  check(poster.post(cleanup = true) { callbacks++; worker.shutdown(); cleaned.countDown() })
  check(cleaned.await(2, java.util.concurrent.TimeUnit.SECONDS))
  // Equivalent to onFailure -> released -> shutdown -> late onClosed/onFailure.
  check(!poster.post(cleanup = true) { error("late onClosed") })
  check(!poster.post(cleanup = true) { error("late onFailure") })
  check(!poster.later { error("late scheduled backpressure") })
  check(callbacks in 1..2) // Queued ordinary work may be suppressed by invalidation.
  println("PASS native ACK/admission, real JS little-endian fixtures + 6883-frame LAST, safe categories, executor shutdown/late callbacks")
}
