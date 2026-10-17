package com.vinoteapp

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files

private var passed = 0
private fun test(name: String, block: () -> Unit) { block(); passed++; println("PASS $name") }
private fun fails(block: () -> Unit) { check(runCatching(block).isFailure) }
private fun wav(file: File, size: Int = 12800): ByteArray {
  val data = ByteArray(size) { (it % 251).toByte() }
  val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
  header.put("RIFF".toByteArray()).putInt(size + 36).put("WAVEfmt ".toByteArray())
  header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
  header.put("data".toByteArray()).putInt(size)
  file.writeBytes(header.array() + data)
  return data
}
fun main() {
  val cache = Files.createTempDirectory(File("tests/tmp").apply { mkdirs() }.toPath(), "pcm-test").toFile()
  val source = File(cache, "asr-synthetic.wav"); val data = wav(source)
  try {
    test("exact sequential full frames and EOF releases descriptor") {
      val store = PcmReaderStore(cache); val h = store.open(source.path, 0, 12800)
      check(store.read(h, 0, 6400).contentEquals(data.copyOfRange(0, 6400)))
      check(store.handleCount() == 1)
      check(store.read(h, 6400, 6400).contentEquals(data.copyOfRange(6400, 12800)))
      check(store.handleCount() == 0); store.close(h); fails { store.read(h, 0, 2) }
    }
    test("interval offsets never expose header or bytes beyond frozen end") {
      val store = PcmReaderStore(cache); val h = store.open(source.path, 6, 10)
      check(store.read(h, 6, 4).contentEquals(data.copyOfRange(6, 10)))
      check(store.handleCount() == 0)
    }
    test("two handle bound and slot reuse after cancellation") {
      val store = PcmReaderStore(cache); val a = store.open(source.path, 0, 2); val b = store.open(source.path, 0, 2)
      fails { store.open(source.path, 0, 2) }; check(store.handleCount() == 2)
      store.close(a); store.close(a); store.close(b)
      val c = store.open(source.path, 0, 2); store.close(c); check(store.handleCount() == 0)
    }
    test("invalid frame lengths and out of order positions fail closed") {
      for ((pos, length) in listOf(0L to 6402, 0L to 1, 2L to 2, 0L to 12802)) {
        val store = PcmReaderStore(cache); val h = store.open(source.path, 0, 12800)
        fails { store.read(h, pos, length) }; check(store.handleCount() == 0)
      }
    }
    test("short read after truncation fails without padding and closes") {
      val copy = File(cache, "asr-truncate.wav"); wav(copy)
      val store = PcmReaderStore(cache); val h = store.open(copy.path, 0, 12800)
      RandomAccessFile(copy, "rw").use { it.setLength(46) }
      fails { store.read(h, 0, 6400) }; check(store.handleCount() == 0)
    }
    test("invalidate closes all and queued operations cannot reopen") {
      val store = PcmReaderStore(cache); val h = store.open(source.path, 0, 2)
      store.dispose(); check(store.handleCount() == 0)
      fails { store.read(h, 0, 2) }; fails { store.open(source.path, 0, 2) }; store.close(h); store.dispose()
    }
    test("outside cache and original naming are rejected read only") {
      val outside = File(cache.parentFile, "asr-${cache.name}.wav"); wav(outside)
      try { fails { PcmReaderStore(cache).open(outside.path, 0, 2) } } finally { outside.delete() }
      val original = File(cache, "original.wav"); wav(original)
      fails { PcmReaderStore(cache).open(original.path, 0, 2) }
    }
    test("invalid header and interval do not consume handle slots") {
      val bad = File(cache, "asr-bad.wav"); bad.writeBytes(ByteArray(44))
      val store = PcmReaderStore(cache)
      fails { store.open(bad.path, 0, 2) }
      for ((a,b) in listOf(-2L to 2L, 1L to 2L, 0L to 12802L, 2L to 2L)) fails { store.open(source.path, a, b) }
      check(store.handleCount() == 0)
    }
    check(source.readBytes().copyOfRange(44, 12844).contentEquals(data))
    println("RESULT $passed passed; original unchanged")
  } finally { cache.listFiles()?.forEach { check(it.delete()) }; check(cache.delete()) }
}
