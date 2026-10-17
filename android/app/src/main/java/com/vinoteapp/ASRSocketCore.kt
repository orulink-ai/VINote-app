package com.vinoteapp

import okhttp3.*
import okio.ByteString.Companion.toByteString
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Dedicated ASR sockets; never changes the shared RN WebSocket module/client. */
internal interface ASRSocketResult {
  fun success(queueBytes: Long? = null)
  fun failure(category: Int)
}

/** Production socket state machine, with no Android dependency or provider retry. */
internal class ASRSocketCore(private val trustedOrigin: String, private val baseClient: OkHttpClient,
  private val notify: (String, String, Int?, String?) -> Unit) {
  private val worker = Executors.newSingleThreadScheduledExecutor()
  private val poster = ASRSafePoster(worker)
  private class Session(val id: String, expectedBytes: Long) {
    val coverage = ASRFrameCoverage(expectedBytes)
    var socket: WebSocket? = null
    var terminal = false
    var closing = false
    @Volatile var peerClosing = false
    var startSent = false
    var pending: ASRSocketResult? = null
    val closers = mutableListOf<ASRSocketResult>()
    val queuedMessageBytes = AtomicLong()
    val upstreamRejected = AtomicBoolean()
  }
  // Accessed only on worker. One live ASR resource, including teardown, per module.
  private var active: Session? = null
  private var invalidated = false
  private fun ASRSocketResult.reportSuccess(queueBytes: Long? = null) {
    try { success(queueBytes) } catch (_: Exception) { /* A destroyed JS observer cannot retain resources. */ }
  }
  private fun ASRSocketResult.reportFailure(category: Int) {
    try { failure(category) } catch (_: Exception) { /* Cleanup proceeds after observer disposal. */ }
  }
  private fun event(s: Session, type: String, category: Int? = null, data: String? = null) {
    if (!poster.invalidated) try { notify(s.id, type, category, data) } catch (_: Exception) { /* Observers cannot break resource cleanup. */ }
  }
  private fun fail(s: Session, category: Int) {
    if (s.terminal) return
    s.terminal = true
    val pending = s.pending; s.pending = null
    pending?.reportFailure(category)
    event(s, "error", category)
    if (!s.peerClosing) s.socket?.cancel()
  }
  private fun released(s: Session) {
    if (active !== s) return
    s.terminal = true
    val pending = s.pending; s.pending = null
    active = null
    val closers = s.closers.toList(); s.closers.clear()
    pending?.reportFailure(0)
    event(s, "closed")
    closers.forEach { it.reportSuccess() }
    if (invalidated) worker.shutdown()
  }

  fun connect(id: String, url: String, token: String, expectedBytes: Long, promise: ASRSocketResult) {
    if (!poster.post(cleanup = true) {
      if (poster.invalidated || active != null) {
        promise.reportFailure(0); return@post
      }
      var s: Session? = null
      try {
        val uri = URI(url)
        val trusted = URI(trustedOrigin.replaceFirst(Regex("^http"), "ws"))
        require(uri.scheme == trusted.scheme && uri.rawAuthority == trusted.rawAuthority)
        require(uri.scheme in listOf("ws", "wss") && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path == "/v1/asr/transcriptions")
        require(id.matches(Regex("[a-zA-Z0-9-]{1,80}")) && expectedBytes > 0 && expectedBytes <= Int.MAX_VALUE)
        val session = Session(id, expectedBytes.toLong()); s = session; active = session
        val client = asrHttpClient(baseClient)
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        session.socket = client.newWebSocket(request, object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) { poster.post(cleanup = true) {
            if (poster.invalidated || session.closing || session.terminal) webSocket.cancel() else event(session, "open")
          } }
          override fun onMessage(webSocket: WebSocket, text: String) {
            if (session.upstreamRejected.get() || poster.invalidated) return
            val size = ASRTransportPolicy.messageBytes(text)
            if (size < 0 || session.queuedMessageBytes.addAndGet(size.toLong()) > ASRTransportPolicy.MESSAGE_LIMIT) {
              if (size >= 0) session.queuedMessageBytes.addAndGet(-size.toLong())
              if (session.upstreamRejected.compareAndSet(false, true)) poster.post(cleanup = true) { fail(session, ASRTransportPolicy.PROTOCOL) }
              return
            }
            if (!poster.post {
              try { if (!session.terminal && !session.closing && !session.upstreamRejected.get()) event(session, "message", data = text) }
              finally { session.queuedMessageBytes.addAndGet(-size.toLong()) }
            }) session.queuedMessageBytes.addAndGet(-size.toLong())
          }
          override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
            if (session.upstreamRejected.compareAndSet(false, true)) poster.post(cleanup = true) { fail(session, ASRTransportPolicy.PROTOCOL) }
          }
          override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            session.peerClosing = true
            poster.post(cleanup = true) {
              if (!session.closing && !session.terminal) {
                session.closing = true
                val pending = session.pending; session.pending = null
                pending?.reportFailure(ASRTransportPolicy.SEND_REJECTED)
                event(session, "peerClosing", if (code in 1000..4999) code else 1006)
              }
            }
            // Complete the received close handshake. cancel() alone after the reader
            // has returned from a close frame may never produce a termination callback.
            webSocket.close(if (code == 1005) 1000 else code, null)
          }
          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { poster.post(cleanup = true) { released(session) } }
          override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { poster.post(cleanup = true) {
            if (!session.closing) fail(session, ASRTransportPolicy.classify(t))
            released(session)
          } }
        })
        promise.reportSuccess()
      } catch (_: Exception) {
        s?.let { active = null }
        promise.reportFailure(10)
      }
    }) promise.reportFailure(0)
  }

  fun enqueue(id: String, text: String?, frame: ByteArray?, promise: ASRSocketResult) {
    if (!poster.post(cleanup = true) {
      val s = active
      if (poster.invalidated || s == null || s.id != id || s.terminal || s.closing || s.pending != null) {
        promise.reportFailure(1); return@post
      }
      try {
        if (frame != null) require(text == null && s.startSent && s.coverage.valid(frame))
        else require(text != null && !s.startSent && text.toByteArray(Charsets.UTF_8).size <= 4096)
        s.pending = promise
        val deadline = (System.nanoTime() / 1_000_000) + ASRTransportPolicy.WAIT_MS
        fun attempt() {
          if (s.terminal || s.closing || active !== s) return
          val socket = s.socket ?: run { fail(s, ASRTransportPolicy.SEND_REJECTED); return }
          val size = frame?.size ?: text!!.toByteArray(Charsets.UTF_8).size
          val admission = ASRTransportPolicy.admission(socket.queueSize(), size, (System.nanoTime() / 1_000_000), deadline)
          if (admission != 0) {
            if (admission == ASRTransportPolicy.BACKPRESSURE_TIMEOUT) fail(s, ASRTransportPolicy.BACKPRESSURE_TIMEOUT)
            else if (!poster.later { attempt() }) fail(s, ASRTransportPolicy.UNKNOWN)
            return
          }
          try {
            val accepted = if (frame != null) s.coverage.enqueue(frame) { socket.send(frame.toByteString()) } else socket.send(text!!)
            if (!accepted) { fail(s, ASRTransportPolicy.SEND_REJECTED); return }
            if (frame == null) s.startSent = true
            s.pending = null
            promise.reportSuccess(socket.queueSize())
          } catch (error: Exception) { fail(s, ASRTransportPolicy.classify(error)) }
        }
        attempt()
      } catch (_: Exception) {
        promise.reportFailure(10)
        fail(s, ASRTransportPolicy.PROTOCOL)
      }
    }) promise.reportFailure(0)
  }

  fun close(id: String, promise: ASRSocketResult) { if (!poster.post(cleanup = true) {
    val s = active
    if (s == null || s.id != id) { promise.reportSuccess(); return@post }
    s.closers.add(promise); s.closing = true
    val pending = s.pending; s.pending = null
    pending?.reportFailure(0)
    // cancel is immediate; only onFailure/onClosed confirms resource termination.
    if (!s.peerClosing) s.socket?.cancel()
  }) promise.reportSuccess() }
  fun invalidate() {
    poster.invalidate()
    poster.post(cleanup = true) {
      invalidated = true
      val s = active
      if (s == null) worker.shutdown() else { s.closing = true; if (!s.peerClosing) s.socket?.cancel() }
    }
  }
}
