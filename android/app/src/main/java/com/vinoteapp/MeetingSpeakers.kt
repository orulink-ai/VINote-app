package com.vinoteapp

import android.net.Uri
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.*
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

/** Independent on-device bounded-window speaker analysis. Never opens the microphone. */
class MeetingSpeakers(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()
  override fun getName() = "MeetingSpeakers"
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  /** Bounded feature batches; only 8 seconds of PCM are held per window. */
  @ReactMethod fun embeddings(uri: String, windows: ReadableArray, jobId: String, promise: Promise) { worker.execute {
    var extractor: SpeakerEmbeddingExtractor? = null
    try {
      require(windows.size() in 1..128) { "声音特征批次数量无效" }
      val source = File(Uri.parse(uri).path ?: uri).canonicalFile
      require(source.parentFile == context.cacheDir.canonicalFile && source.name.startsWith("asr-") && source.extension == "wav") { "声音特征缓存路径无效" }
      val features = Arguments.createArray()
      RandomAccessFile(source, "r").use { input ->
        val header = ByteArray(44); input.readFully(header)
        val layout = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        require(String(header, 0, 4) == "RIFF" && String(header, 8, 8) == "WAVEfmt " && layout.getShort(20).toInt() == 1 && layout.getShort(22).toInt() == 1 && layout.getInt(24) == 16000 && layout.getShort(34).toInt() == 16 && String(header, 36, 4) == "data" && layout.getInt(40).toLong() == source.length() - 44) { "声音特征音频格式无效" }
        extractor = SpeakerEmbeddingExtractor(context.assets, SpeakerEmbeddingExtractorConfig(model = "speaker/embedding.onnx", numThreads = 2, provider = "cpu"))
        repeat(windows.size()) { index ->
          val window = windows.getMap(index) ?: error("声音特征区间无效")
          val start = window.getDouble("start"); val end = window.getDouble("end")
          require(start.isFinite() && end.isFinite() && start >= 0 && end > start && end - start <= 8.001 && end * 16000 <= (source.length() - 44) / 2.0 + 1) { "声音特征区间超出录音" }
          val count = ((end - start) * 16000).toInt()
          val bytes = ByteArray(count * 2)
          input.seek(44 + (start * 16000).toLong() * 2)
          input.readFully(bytes)
          val pcm = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
          val values = FloatArray(count) { pcm.short / 32768.0f }
          val stream = extractor!!.createStream()
          try {
            stream.acceptWaveform(values, 16000); stream.inputFinished()
            if (extractor!!.isReady(stream)) {
              val vector = Arguments.createArray()
              extractor!!.compute(stream).forEach { vector.pushDouble(it.toDouble()) }
              features.pushArray(vector)
            } else features.pushNull()
          } finally { stream.release() }
          context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("meetingSpeakerProgress", Arguments.createMap().apply { putString("jobId", jobId); putString("phase", "refining"); putInt("progress", (index + 1) * 100 / windows.size()) })
        }
      }
      promise.resolve(features)
    } catch (error: Throwable) { promise.reject("SPEAKER_FEATURES", error.message ?: "声音特征分析失败，请重试", error) }
    finally { extractor?.release() }
  } }
  @ReactMethod fun analyze(uri: String, jobId: String, promise: Promise) = analyzeRange(uri, 0.0, null, jobId, promise)

  /** At most 120s core plus 5s context on either side. IDs are local to this window. */
  @ReactMethod fun analyzeWindow(uri: String, start: Double, end: Double, jobId: String, promise: Promise) =
    analyzeRange(uri, start, end, jobId, promise)

  private fun analyzeRange(uri: String, start: Double, end: Double?, jobId: String, promise: Promise) { worker.execute {
    var engine: OfflineSpeakerDiarization? = null
    try {
      val source = File(Uri.parse(uri).path ?: uri).canonicalFile
      require(source.parentFile == context.cacheDir.canonicalFile && source.name.startsWith("asr-") && source.extension == "wav") { "说话人分析缓存路径无效" }
      val samples = RandomAccessFile(source, "r").use { input ->
        val header = ByteArray(44); input.readFully(header)
        val layout = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        require(String(header, 0, 4) == "RIFF" && String(header, 8, 8) == "WAVEfmt " && layout.getShort(20).toInt() == 1 && layout.getShort(22).toInt() == 1 && layout.getInt(24) == 16000 && layout.getShort(34).toInt() == 16 && String(header, 36, 4) == "data" && layout.getInt(40).toLong() == source.length() - 44) { "说话人分析需要完整的 16k 单声道音频" }
        val sourceSamples = (source.length() - 44) / 2
        val duration = sourceSamples / 16000.0
        val stop = end ?: duration
        require(start.isFinite() && stop.isFinite() && start >= 0 && stop > start &&
          stop <= duration + 1.0 / 16000 && stop - start <= 130) {
          "说话人分析每次最多130秒；长录音请使用新版分窗流程，原件已保留"
        }
        val startSample = (start * 16000).toLong()
        val stopSample = minOf(sourceSamples, (stop * 16000).toLong())
        val size = stopSample - startSample
        require(size > 0 && size <= 16000L * 130) { "说话人分析区间无效" }
        input.seek(44 + startSample * 2)
        val values = FloatArray(size.toInt())
        val buffer = ByteArray(65536); var offset = 0
        while (offset < values.size) {
          val bytes = minOf(buffer.size, (values.size - offset) * 2)
          input.readFully(buffer, 0, bytes)
          val pcm = ByteBuffer.wrap(buffer, 0, bytes).order(ByteOrder.LITTLE_ENDIAN)
          repeat(bytes / 2) { values[offset++] = pcm.short / 32768.0f }
        }
        values
      }
      val config = OfflineSpeakerDiarizationConfig(
        segmentation = OfflineSpeakerSegmentationModelConfig(pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(model = "speaker/segmentation.onnx"), numThreads = 2, provider = "cpu"),
        embedding = SpeakerEmbeddingExtractorConfig(model = "speaker/embedding.onnx", numThreads = 2, provider = "cpu"),
        clustering = FastClusteringConfig(numClusters = -1, threshold = 0.5f),
        minDurationOn = 0.3f, minDurationOff = 0.5f,
      )
      engine = OfflineSpeakerDiarization(context.assets, config)
      require(engine.sampleRate() == 16000) { "说话人模型采样率异常" }
      var previous = -1
      // JNI looks up the primitive-argument invoke method. Kotlin 2's indy
      // lambda exposes only its erased SAM bridge, so use an explicit object.
      val callback = object : Function3<Int, Int, Long, Int> {
        override fun invoke(done: Int, total: Int, userData: Long): Int {
          val percent = (done * 100 / maxOf(total, 1)) / 5 * 5
          if (percent != previous) {
            previous = percent
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("meetingSpeakerProgress", Arguments.createMap().apply { putString("jobId", jobId); putInt("progress", percent) })
          }
          return 0
        }
      }
      val segments = engine.processWithCallback(samples, callback, 0).sortedBy { it.start }
      // A quiet window is valid; only JS checks whether the entire recording
      // has any detected speech after all windows have been preserved.
      val turns = Arguments.createArray()
      segments.forEach { turn ->
        require(turn.start.isFinite() && turn.end.isFinite() && turn.end > turn.start && turn.start >= 0) { "说话人分析返回无效时间轴" }
        turns.pushMap(Arguments.createMap().apply { putDouble("start", turn.start.toDouble()); putDouble("end", minOf(turn.end.toDouble(), samples.size / 16000.0)); putInt("speaker", turn.speaker) })
      }
      promise.resolve(Arguments.createMap().apply { putString("provider", "sherpa-onnx"); putDouble("duration", samples.size / 16000.0); putArray("segments", turns) })
    } catch (error: Throwable) { promise.reject("SPEAKER_ANALYSIS", error.message ?: "说话人分析失败，请重试", error) }
    finally { engine?.release() }
  } }
  override fun invalidate() { worker.shutdown(); super.invalidate() }
}
