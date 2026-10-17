package com.vinoteapp

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files

fun main() {
  var passed = 0
  fun test(name: String, block: () -> Unit) { block(); passed++; println("PASS $name") }
  val cache = Files.createTempDirectory(File("tests/tmp").apply { mkdirs() }.toPath(), "diagnostics").toFile()
  val file = File(cache, "asr-private-source.wav")
  val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
  header.put("RIFF".toByteArray()).putInt(12836).put("WAVEfmt ".toByteArray())
  header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
  header.put("data".toByteArray()).putInt(12800)
  file.writeBytes(header.array() + ByteArray(12800))
  try {
    test("open is confirmed; no per read events; EOF summary exact and idempotent") {
      val events = mutableListOf<PcmDiagnostic>(); var now = 0L
      val d = PcmReaderDiagnostics(true, { events.add(it) }, { now += 7000; now })
      val s = PcmReaderStore(cache, diagnostics = d); val h = s.open(file.path, 0, 12800)
      check(events.single().event == PcmDiagnosticEvent.OPEN_OK && events.single().active == 1)
      s.read(h, 0, 6400); check(events.size == 1)
      s.read(h, 6400, 6400); s.close(h); s.dispose()
      check(events.size == 2)
      val e = events.last()
      check(e.event == PcmDiagnosticEvent.CLOSE_OK && e.reason == PcmCloseReason.EOF)
      check(e.reads == 2L && e.bytes == 12800L && e.maxReadUs == 7L && e.readErrors == 0L && e.active == 0)
      check(events.none { it.safeLine().contains(file.path) || it.safeLine().contains(h) })
      check(e.safeLine().matches(Regex("event=CLOSE_OK mode=NATIVE_SESSION intervalBytes=12800 active=0 reason=EOF reads=2 bytes=12800 maxReadUs=7 readErrors=0 remaining=0")))
    }
    test("disabled diagnostics never call clock or sink") {
      val d = PcmReaderDiagnostics(false, { error("sink invoked") }, { error("clock invoked") })
      val s = PcmReaderStore(cache, diagnostics = d); val h = s.open(file.path, 0, 2)
      s.read(h, 0, 2); check(s.handleCount() == 0)
    }
    test("null release diagnostics preserve reader") {
      val s = PcmReaderStore(cache); val h = s.open(file.path, 0, 2)
      check(s.read(h, 0, 2).size == 2 && s.handleCount() == 0)
    }
    test("explicit cleanup reports partial bytes without invented cancellation") {
      val events = mutableListOf<PcmDiagnostic>()
      val s = PcmReaderStore(cache, diagnostics = PcmReaderDiagnostics(true, { events.add(it) }))
      val h = s.open(file.path, 0, 12800); s.read(h, 0, 2); s.close(h); s.close(h)
      check(events.size == 2 && events.last().reason == PcmCloseReason.EXPLICIT)
      check(events.last().bytes == 2L && events.last().reads == 1L && events.last().active == 0)
    }
    test("failed read counted once without padded successful bytes") {
      val copy = File(cache, "asr-truncated.wav"); copy.writeBytes(file.readBytes())
      val events = mutableListOf<PcmDiagnostic>()
      val s = PcmReaderStore(cache, diagnostics = PcmReaderDiagnostics(true, { events.add(it) }))
      val h = s.open(copy.path, 0, 12800)
      RandomAccessFile(copy, "rw").use { it.setLength(46) }
      check(runCatching { s.read(h, 0, 6400) }.isFailure)
      check(events.last().reason == PcmCloseReason.READ_ERROR && events.last().readErrors == 1L)
      check(events.last().reads == 0L && events.last().bytes == 0L && s.handleCount() == 0)
    }
    test("invalidate two readers reports confirmed remaining one then zero") {
      val events = mutableListOf<PcmDiagnostic>()
      val s = PcmReaderStore(cache, diagnostics = PcmReaderDiagnostics(true, { events.add(it) }))
      s.open(file.path, 0, 2); s.open(file.path, 2, 4); s.dispose(); s.dispose()
      check(events.map { it.active } == listOf(1, 2, 1, 0))
      check(events.takeLast(2).all { it.reason == PcmCloseReason.INVALIDATE })
      check(runCatching { s.open(file.path, 0, 2) }.isFailure && events.size == 4)
    }
    test("diagnostic sink failure cannot corrupt PCM lifecycle") {
      val s = PcmReaderStore(cache, diagnostics = PcmReaderDiagnostics(true, { error("sink fails") }))
      val h = s.open(file.path, 0, 2); check(s.read(h, 0, 2).size == 2)
      check(s.handleCount() == 0)
    }
    test("invalid opens never claim native success") {
      val events = mutableListOf<PcmDiagnostic>()
      val s = PcmReaderStore(cache, diagnostics = PcmReaderDiagnostics(true, { events.add(it) }))
      check(runCatching { s.open(file.path, 1, 2) }.isFailure)
      check(events.isEmpty() && s.handleCount() == 0)
    }
    println("RESULT $passed passed")
  } finally { cache.listFiles()?.forEach { check(it.delete()) }; check(cache.delete()) }
}
