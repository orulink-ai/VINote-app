package com.vinoteapp

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/** Module cache only. One read-only descriptor per handle, fixed frame/handle bounds. */
internal class PcmReaderStore(private val cacheDir: File, private val maxHandles: Int = 2,
  private val diagnostics: PcmReaderDiagnostics? = null) {
  private data class Session(val input: RandomAccessFile, var position: Long, val end: Long, val intervalBytes: Long,
    var reads: Long = 0, var bytes: Long = 0, var maxReadUs: Long = 0, var readErrors: Long = 0)
  private val sessions = mutableMapOf<String, Session>()
  private var disposed = false

  @Synchronized fun open(path: String, start: Long, end: Long): String {
    check(!disposed && sessions.size < maxHandles) { "PCM_READER_UNAVAILABLE" }
    require(start >= 0 && end > start && start % 2 == 0L && end % 2 == 0L)
    val source = File(path).canonicalFile
    require(source.parentFile == cacheDir.canonicalFile && source.name.startsWith("asr-") && source.extension == "wav")
    val input = RandomAccessFile(source, "r")
    try {
      val bytes = ByteArray(44); input.readFully(bytes)
      val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      val size = input.length() - 44
      require(String(bytes, 0, 4) == "RIFF" && header.getInt(4).toLong() == size + 36 &&
        String(bytes, 8, 8) == "WAVEfmt " && header.getInt(16) == 16 &&
        header.getShort(20).toInt() == 1 && header.getShort(22).toInt() == 1 &&
        header.getInt(24) == 16000 && header.getInt(28) == 32000 &&
        header.getShort(32).toInt() == 2 && header.getShort(34).toInt() == 16 &&
        String(bytes, 36, 4) == "data" && header.getInt(40).toLong() == size && end <= size)
      val handle = UUID.randomUUID().toString()
      sessions[handle] = Session(input, start, end, end - start)
      diagnostics?.emit(PcmDiagnostic(PcmDiagnosticEvent.OPEN_OK, intervalBytes = end - start, active = sessions.size))
      return handle
    } catch (error: Exception) { input.close(); throw error }
  }

  @Synchronized fun read(handle: String, position: Long, length: Int): ByteArray {
    check(!disposed)
    val session = sessions[handle] ?: error("PCM_READER_CLOSED")
    val started = diagnostics?.now() ?: 0L
    try {
      require(length in 2..6400 && length % 2 == 0 && position == session.position &&
        position <= session.end - length)
      val bytes = ByteArray(length)
      session.input.seek(44 + position)
      session.input.readFully(bytes) // No padded partial reads or whole-file buffers.
      session.position += length
      if (diagnostics?.enabled == true) {
        session.reads++; session.bytes += length
        session.maxReadUs = maxOf(session.maxReadUs, maxOf(0L, diagnostics.now() - started) / 1000)
      }
      if (session.position == session.end) close(handle, PcmCloseReason.EOF)
      return bytes
    } catch (error: Exception) {
      if (diagnostics?.enabled == true) session.readErrors++
      close(handle, PcmCloseReason.READ_ERROR); throw error
    }
  }

  @Synchronized fun close(handle: String, reason: PcmCloseReason = PcmCloseReason.EXPLICIT) {
    val session = sessions[handle] ?: return // EOF close and JS cleanup are idempotent.
    try { session.input.close() }
    catch (error: Exception) { reportClose(session, PcmDiagnosticEvent.CLOSE_FAILED, reason); throw error }
    sessions.remove(handle)
    reportClose(session, PcmDiagnosticEvent.CLOSE_OK, reason)
  }

  @Synchronized fun dispose() {
    disposed = true
    var failure: Exception? = null
    sessions.keys.toList().forEach { handle ->
      try { close(handle, PcmCloseReason.INVALIDATE) } catch (error: Exception) { failure = error }
    }
    failure?.let { throw it }
  }

  private fun reportClose(session: Session, event: PcmDiagnosticEvent, reason: PcmCloseReason) {
    diagnostics?.emit(PcmDiagnostic(event, intervalBytes = session.intervalBytes, active = sessions.size,
      reason = reason, reads = session.reads, bytes = session.bytes, maxReadUs = session.maxReadUs,
      readErrors = session.readErrors))
  }

  @Synchronized internal fun handleCount() = sessions.size
}
