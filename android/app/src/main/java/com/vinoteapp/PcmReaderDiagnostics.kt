package com.vinoteapp

/** Closed schema: never accepts paths, handles, owner IDs, content or exceptions. */
internal enum class PcmDiagnosticEvent { OPEN_OK, CLOSE_OK, CLOSE_FAILED }
internal enum class PcmCloseReason { EOF, EXPLICIT, READ_ERROR, INVALIDATE }
internal enum class PcmReaderMode { NATIVE_SESSION }
internal data class PcmDiagnostic(
  val event: PcmDiagnosticEvent,
  val mode: PcmReaderMode = PcmReaderMode.NATIVE_SESSION,
  val intervalBytes: Long,
  val active: Int,
  val reason: PcmCloseReason? = null,
  val reads: Long = 0,
  val bytes: Long = 0,
  val maxReadUs: Long = 0,
  val readErrors: Long = 0,
) {
  fun safeLine(): String = "event=${event.name} mode=${mode.name} intervalBytes=$intervalBytes active=$active" +
    (reason?.let { " reason=${it.name} reads=$reads bytes=$bytes maxReadUs=$maxReadUs readErrors=$readErrors remaining=$active" } ?: "")
}
internal class PcmReaderDiagnostics(
  val enabled: Boolean,
  private val sink: (PcmDiagnostic) -> Unit,
  private val clock: () -> Long = System::nanoTime,
) {
  fun now(): Long = if (enabled) try { clock() } catch (_: Exception) { 0L } else 0L
  fun emit(value: PcmDiagnostic) {
    if (enabled) try { sink(value) } catch (_: Exception) { /* Diagnostics never change audio outcomes. */ }
  }
}
