package com.vinoteapp

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import sun.misc.Unsafe

/** JVM harness calls the real compiled invalidate(), bypassing Android construction.
 * This is executor/store lifecycle evidence, NOT ReactContext/device acceptance. */
fun main() {
  val unsafeField = Unsafe::class.java.getDeclaredField("theUnsafe").apply { isAccessible = true }
  val unsafe = unsafeField.get(null) as Unsafe
  val module = unsafe.allocateInstance(MeetingAudioModule::class.java) as MeetingAudioModule
  val conversion = Executors.newSingleThreadExecutor()
  val cache = Files.createTempDirectory(File("tests/tmp").apply { mkdirs() }.toPath(), "invalidate-").toFile()
  val store = PcmReaderStore(cache)
  fun field(name: String, value: Any) {
    MeetingAudioModule::class.java.getDeclaredField(name).apply { isAccessible = true }.set(module, value)
  }
  // The module pcmIO field is ThreadPoolExecutor; use the same bounded executor type.
  val io = java.util.concurrent.ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
    java.util.concurrent.ArrayBlockingQueue<Runnable>(16))
  field("worker", conversion); field("pcmIO", io); field("pcmReaders", store)
  val active = CountDownLatch(2); val release = CountDownLatch(1)
  val conversionCompleted = AtomicInteger(); val invalidPcmRejected = AtomicInteger()
  val source = File(cache, "asr-synthetic.wav")
  val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
  header.put("RIFF".toByteArray()).putInt(38).put("WAVEfmt ".toByteArray())
  header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
  header.put("data".toByteArray()).putInt(2)
  source.writeBytes(header.array() + byteArrayOf(1, 2))
  val handle = store.open(source.path, 0, 2)
  try {
    conversion.execute { active.countDown(); check(release.await(2, TimeUnit.SECONDS)); conversionCompleted.incrementAndGet() }
    conversion.execute { conversionCompleted.incrementAndGet() } // Queued promise-equivalent work.
    io.execute { active.countDown(); check(release.await(2, TimeUnit.SECONDS)) }
    io.execute { if (runCatching { store.read(handle, 0, 2) }.isFailure) invalidPcmRejected.incrementAndGet() }
    check(active.await(2, TimeUnit.SECONDS))
    module.invalidate() // Actual production method, not a duplicated shutdown helper.
    check(conversion.isShutdown && io.isShutdown)
    check(!conversion.isTerminated && !io.isTerminated) // No interruption/discard.
    check(store.handleCount() == 0)
    check(runCatching { store.open(source.path, 0, 2) }.isFailure)
    release.countDown()
    check(conversion.awaitTermination(2, TimeUnit.SECONDS) && io.awaitTermination(2, TimeUnit.SECONDS))
    check(conversionCompleted.get() == 2 && invalidPcmRejected.get() == 1)
    module.invalidate() // Idempotent repeated disposal.
    check(runCatching { conversion.execute {} }.isFailure)
    check(runCatching { io.execute {} }.isFailure)
    println("PASS actual invalidate closes handles, gracefully drains both executors, rejects later calls and terminates; repeated invalidate safe")
  } finally {
    release.countDown(); conversion.shutdown(); io.shutdown()
    store.dispose(); check(source.delete()); check(cache.delete())
  }
}
