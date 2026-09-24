package com.vinoteapp

import android.media.*
import android.net.Uri
import com.facebook.react.bridge.*
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.Executors

/** 原音频只读，流式转换为 16kHz/mono/PCM16 WAV，避免整段音频进入内存。 */
class MeetingAudioModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()
  override fun getName() = "MeetingAudio"
  @ReactMethod
  fun audioInfo(uri: String, promise: Promise) { worker.execute {
    val retriever = MediaMetadataRetriever()
    try {
      val file = File(Uri.parse(uri).path ?: uri).canonicalFile
      require(file.path.startsWith(context.filesDir.canonicalPath + File.separator)) { "录音路径无效" }
      retriever.setDataSource(file.path)
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000)
      require(duration != null && duration > 0) { "音频未完成或没有有效时长，请检查录音" }
      promise.resolve(duration)
    } catch (e: Exception) { promise.reject("AUDIO_INFO", e.message, e) }
    finally { retriever.release() }
  } }
  /** 只允许切分本模块生成的缓存；固定 120 秒上传块，不把长录音读入内存。 */
  @ReactMethod
  fun wavInfo(uri: String, promise: Promise) { worker.execute {
    try {
      val source = cachedWav(uri)
      promise.resolve((source.length() - 44).toDouble() / 32000.0)
    } catch (error: Exception) { promise.reject("AUDIO_INFO", error.message, error) }
  } }

  private fun cachedWav(uri: String): File {
    val source = File(Uri.parse(uri).path ?: uri).canonicalFile
    require(source.parentFile == context.cacheDir.canonicalFile && source.name.startsWith("asr-") && source.extension == "wav") { "音频缓存路径无效" }
    RandomAccessFile(source, "r").use { input ->
      val bytes = ByteArray(44); input.readFully(bytes)
      val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      require(String(bytes, 0, 4) == "RIFF" && String(bytes, 8, 8) == "WAVEfmt " &&
        header.getInt(16) == 16 && header.getShort(20).toInt() == 1 && header.getShort(22).toInt() == 1 &&
        header.getInt(24) == 16000 && header.getShort(34).toInt() == 16 && String(bytes, 36, 4) == "data" &&
        header.getInt(40).toLong() == source.length() - 44) { "音频缓存格式无效" }
    }
    return source
  }

  @ReactMethod
  fun wavChunk(uri: String, index: Double, promise: Promise) { worker.execute {
    val output = File(context.cacheDir, "asr-${UUID.randomUUID()}.wav")
    try {
      require(index.isFinite() && index >= 0 && index == kotlin.math.floor(index)) { "分段索引无效" }
      val source = cachedWav(uri)
      val offset = index.toLong() * 120L * 32000L
      val length = minOf(120L * 32000L, source.length() - 44 - offset)
      require(length > 0) { "分段超出录音范围" }
      RandomAccessFile(source, "r").use { input ->
        val header = ByteArray(44); input.readFully(header)
        ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).putInt(4, length.toInt() + 36).putInt(40, length.toInt())
        output.outputStream().use { target ->
          target.write(header); input.seek(44 + offset)
          val buffer = ByteArray(65536)
          var remaining = length
          while (remaining > 0) {
            val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            check(count > 0) { "音频缓存不完整" }
            target.write(buffer, 0, count); remaining -= count
          }
        }
      }
      promise.resolve(Uri.fromFile(output).toString())
    } catch (error: Exception) { output.delete(); promise.reject("AUDIO_CHUNK", error.message, error) }
  } }
  @ReactMethod
  fun toWav(uri: String, promise: Promise) { worker.execute {
    val output = File(context.cacheDir, "asr-${UUID.randomUUID()}.wav")
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    try {
      val source = File(Uri.parse(uri).path ?: uri).canonicalFile
      require(source.path.startsWith(context.filesDir.canonicalPath + File.separator)) { "录音路径无效" }
      extractor.setDataSource(source.path)
      val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: error("没有音轨")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      decoder = codec
      codec.configure(format, null, null, 0); codec.start()
      RandomAccessFile(output, "rw").use { file ->
        file.write(ByteArray(44))
        val pending = ByteBuffer.allocate(32768).order(ByteOrder.LITTLE_ENDIAN)
        var sourceIndex = 0L
        var nextOutput = 0L
        var previous = 0.0
        var inputEnded = false
        var outputEnded = false
        var lastProgress = System.nanoTime()
        val info = MediaCodec.BufferInfo()
        while (!outputEnded) {
          check(System.nanoTime() - lastProgress < 30_000_000_000L) { "音频转换超时" }
          if (!inputEnded) {
            val index = codec.dequeueInputBuffer(10000)
            if (index >= 0) {
              val count = extractor.readSampleData(codec.getInputBuffer(index)!!, 0)
              if (count < 0) {
                codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true
              } else {
                codec.queueInputBuffer(index, 0, count, extractor.sampleTime, 0); extractor.advance()
              }
              lastProgress = System.nanoTime()
            }
          }
          val index = codec.dequeueOutputBuffer(info, 10000)
          if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            val decoded = codec.outputFormat
            rate = decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = decoded.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            encoding = if (decoded.containsKey(MediaFormat.KEY_PCM_ENCODING)) decoded.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
            require(rate > 0 && channels > 0 && encoding in listOf(AudioFormat.ENCODING_PCM_16BIT, AudioFormat.ENCODING_PCM_FLOAT)) { "不支持的解码格式" }
          } else if (index >= 0) {
            val buffer = codec.getOutputBuffer(index)!!.order(ByteOrder.LITTLE_ENDIAN)
            buffer.position(info.offset); buffer.limit(info.offset + info.size)
            val bytes = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
            while (buffer.remaining() >= channels * bytes) {
              var mono = 0.0
              repeat(channels) { mono += if (bytes == 4) buffer.float.toDouble() * 32767.0 else buffer.short.toDouble() }
              mono /= channels
              while (nextOutput * rate <= sourceIndex * 16000L) {
                val position = nextOutput.toDouble() * rate / 16000.0
                val value = if (sourceIndex == 0L) mono else previous + (mono - previous) * (position - (sourceIndex - 1)).coerceIn(0.0, 1.0)
                pending.putShort(value.toInt().coerceIn(-32768, 32767).toShort())
                if (!pending.hasRemaining()) { file.write(pending.array()); pending.clear() }
                nextOutput++
              }
              previous = mono; sourceIndex++
            }
            codec.releaseOutputBuffer(index, false)
            outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            lastProgress = System.nanoTime()
          }
        }
        file.write(pending.array(), 0, pending.position())
        val size = file.length() - 44
        require(size > 0 && size < Int.MAX_VALUE - 36) { "录音为空或文件过大" }
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(size.toInt() + 36).put("WAVEfmt ".toByteArray())
        header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
        header.put("data".toByteArray()).putInt(size.toInt())
        file.seek(0); file.write(header.array())
      }
      promise.resolve(Uri.fromFile(output).toString())
    } catch (error: Exception) {
      output.delete(); promise.reject("AUDIO_CONVERSION", "音频转换失败，原录音已保留：${error.message}")
    } finally {
      runCatching { decoder?.stop() }; runCatching { decoder?.release() }; extractor.release()
    }
  } }
}
