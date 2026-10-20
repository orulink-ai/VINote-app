package com.vinoteapp

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.media.MediaExtractor
import android.media.MediaFormat
import com.facebook.react.bridge.*
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** 选择器先复制到自有缓存，不持久化第三方 content URI。 */
class MeetingFiles(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null
  private var audioOnly = true
  private data class Export(val source: File, val promise: Promise, val size: Long, val modified: Long, val cancelled: AtomicBoolean = AtomicBoolean())
  @Volatile private var exporting: Export? = null
  private val worker = Executors.newSingleThreadExecutor()
  private data class Download(val id: String, val owner: String, val cancelled: AtomicBoolean = AtomicBoolean(), @Volatile var downloader: BilibiliAudioDownloader? = null)
  @Volatile private var invalidated = false
  private val downloadLock = Any()
  private var download: Download? = null
  private fun dispatch(promise: Promise, rejected: () -> Unit = {}, action: () -> Unit) {
    val reject = {
      rejected()
      promise.reject("FILES_UNAVAILABLE", "文件操作已结束，请重新打开后重试；原文件保留")
    }
    if (invalidated || !FileTaskDispatch.execute(worker, Runnable { if (invalidated) reject() else action() })) reject()
  }
  override fun getName() = "MeetingFiles"
  override fun getConstants(): MutableMap<String, Any> = mutableMapOf("bilibiliDownloadProtocol" to 1, "originalMediaProtocol" to 1)
  @ReactMethod fun exportOriginal(uri: String, name: String, owner: String, promise: Promise) {
    context.runOnUiQueueThread {
      try {
        val activity = requireNotNull(context.currentActivity)
        require(!invalidated && exporting == null && pending == null)
        val source = originalMedia(context, uri, owner)
        exporting = Export(source, promise, source.length(), source.lastModified())
        activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE); type = "application/octet-stream"
          putExtra(Intent.EXTRA_TITLE, name.substringAfterLast('/').substringAfterLast('\\').take(180).ifBlank { source.name })
        }, 4211)
      } catch (_: Exception) { if (exporting?.promise === promise) exporting = null; promise.reject("ORIGINAL_EXPORT", "无法打开保存位置，请返回前台重试；原文件保留") }
    }
  }
  @ReactMethod fun cancelOriginalExport() { context.runOnUiQueueThread { exporting?.cancelled?.set(true) } }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  @ReactMethod fun startBilibiliDownload(id: String, owner: String, url: String, maximum: Double, promise: Promise) {
    val job: Download
    try {
      require(Regex("[a-f0-9-]{36}").matches(id) && owner.isNotBlank() && owner.length <= 200 && owner.none { it < ' ' })
      require(maximum.isFinite() && maximum == maximum.toLong().toDouble() && maximum.toLong() in 1..BilibiliDownloadPolicy.MAX_AUDIO)
      BilibiliDownloadPolicy.input(url)
      synchronized(downloadLock) {
        require(!invalidated && download == null) { "已有下载尚未结束" }
        job = Download(id, owner); download = job
      }
    } catch (_: Exception) { promise.reject("BILI_DOWNLOAD_INVALID", "下载未开始，请检查B站链接、分P和文件上限，或等待当前下载结束。"); return }
    dispatch(promise, { synchronized(downloadLock) { if (download === job) download = null } }) {
      val part = File(context.cacheDir, "bilibili-$id.part")
      val target = File(context.cacheDir, "bilibili-$id.m4a")
      var last = 0L
      var ownsFiles = false
      try {
        require(!part.exists() && !target.exists())
        ownsFiles = true
        val downloader = BilibiliAudioDownloader(job.cancelled) { bytes, total ->
          val now = System.nanoTime()
          if (now - last >= 250_000_000 || bytes == total) {
            last = now
            if (context.hasActiveReactInstance()) context.emitDeviceEvent("VINoteBilibiliDownload", Arguments.createMap().apply {
              putString("id", id); putString("owner", owner); putDouble("bytes", bytes.toDouble()); putDouble("total", total.toDouble())
            })
          }
        }
        job.downloader = downloader
        val source = downloader.download(url, part, maximum.toLong())
        downloader.check()
        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(part.path)
          val types = (0 until extractor.trackCount).map { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) ?: "" }
          require(types.any { it.startsWith("audio/") } && types.none { it.startsWith("video/") })
        } finally { extractor.release() }
        downloader.check()
        require(!target.exists() && part.renameTo(target))
        downloader.check()
        synchronized(downloadLock) { if (download === job) download = null }
        promise.resolve(Arguments.createMap().apply {
          putString("uri", Uri.fromFile(target).toString()); putString("title", source.title)
          putString("originalUrl", source.originalUrl); putString("canonicalUrl", source.canonicalUrl)
          putString("bvid", source.bvid); putString("aid", source.aid); putString("cid", source.cid)
          putInt("page", source.page); putDouble("duration", source.duration); putDouble("size", source.size.toDouble())
        })
      } catch (error: Exception) {
        if (ownsFiles) { part.delete(); target.delete() }
        synchronized(downloadLock) { if (download === job) download = null }
        promise.reject("BILI_DOWNLOAD_FAILED", if (error is BilibiliDownloadError) error.message else "无法完整保存B站音频，未提交生成；请重试或导入文件。")
      } finally { synchronized(downloadLock) { if (download === job) download = null } }
    }
  }
  @ReactMethod fun cancelBilibiliDownload(id: String, promise: Promise) {
    synchronized(downloadLock) { download?.takeIf { it.id == id }?.let { it.cancelled.set(true); it.downloader?.cancel() } }
    promise.resolve(null)
  }
  @ReactMethod fun releaseBilibiliDownload(id: String, promise: Promise) {
    if (!Regex("[a-f0-9-]{36}").matches(id)) { promise.reject("BILI_DOWNLOAD_INVALID", "下载记录无效"); return }
    synchronized(downloadLock) { if (download?.id == id) { promise.reject("BILI_DOWNLOAD_ACTIVE", "下载尚未结束，未清理文件"); return } }
    File(context.cacheDir, "bilibili-$id.part").delete(); File(context.cacheDir, "bilibili-$id.m4a").delete(); promise.resolve(null)
  }
  override fun invalidate() {
    invalidated = true
    exporting?.cancelled?.set(true)
    synchronized(downloadLock) { download?.let { it.cancelled.set(true); it.downloader?.cancel() } }
    worker.shutdown(); super.invalidate()
  }
  init { context.addActivityEventListener(object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode == 4211) {
        val job = exporting ?: return
        val destination = data?.data
        if (resultCode != Activity.RESULT_OK || destination == null) { exporting = null; job.promise.resolve("cancelled"); return }
        dispatch(job.promise, { job.cancelled.set(true); if (exporting === job) exporting = null }) {
          try {
            require(destination.scheme == "content" && !job.cancelled.get())
            require(job.source.length() == job.size && job.source.lastModified() == job.modified)
            // rw doesn't truncate. Reject nonempty/unknown-size provider targets
            // before any write, even if a provider returned an existing URI.
            requireNotNull(context.contentResolver.openFileDescriptor(destination, "rw")).use { descriptor ->
              require(descriptor.statSize == 0L)
              job.source.inputStream().use { input -> java.io.FileOutputStream(descriptor.fileDescriptor).use { output ->
                OriginalCopy.copyEmptyTarget(descriptor.statSize, input, output, job.size) { !job.cancelled.get() }
              } }
              require(job.source.length() == job.size && job.source.lastModified() == job.modified && !job.cancelled.get())
            }
            job.promise.resolve("saved")
          } catch (_: Exception) { job.promise.reject("ORIGINAL_EXPORT", "未能完整保存，请选择新的空文件重试。所选位置可能留下不完整副本，请核对；原文件保留") }
          finally {
            // ACTION_CREATE_DOCUMENT normally creates a fresh name, but a URI
            // alone is not independent ownership proof. Never delete its target.
            if (exporting === job) exporting = null
          }
        }
        return
      }
      if (requestCode != 4210) return
      val promise = pending ?: return
      val validateAudio = audioOnly
      pending = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return }
      dispatch(promise) {
        val target = File(context.cacheDir, "import-${UUID.randomUUID()}")
        try {
          var name = "audio.m4a"
          context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
          }
          require(!OriginalFilePolicy.video(name, context.contentResolver.getType(uri))) { "App 不支持导入视频，请在桌面端管理；未保留副本" }
          context.contentResolver.openInputStream(uri)?.use { source -> target.outputStream().use { output ->
            val buffer = ByteArray(65536)
            var total = 0L
            while (true) {
              val count = source.read(buffer)
              if (count < 0) break
              total += count
              require(total <= 2L * 1024 * 1024 * 1024) { "文件不能超过 2 GB" }
              output.write(buffer, 0, count)
            }
            require(total > 0) { "文件为空" }
          } } ?: error("无法读取文件")
          if (validateAudio) {
            val extractor = MediaExtractor()
            try {
              extractor.setDataSource(target.path)
              require((0 until extractor.trackCount).any { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }) { "文件不包含可读取的音轨" }
            } finally { extractor.release() }
          }
          promise.resolve(Arguments.createMap().apply { putString("uri", Uri.fromFile(target).toString()); putString("name", name) })
        } catch (e: Exception) { target.delete(); promise.reject("FILE_IMPORT", "无法导入文件：${e.message}", e) }
      }
    }
  }) }
  @ReactMethod fun pickAudio(promise: Promise) {
    pick(true, promise)
  }
  @ReactMethod fun pickFile(promise: Promise) {
    pick(false, promise)
  }
  private fun pick(onlyAudio: Boolean, promise: Promise) {
    val activity = context.currentActivity
    if (invalidated || activity == null || pending != null || exporting != null) { promise.reject("AUDIO_PICKER", "请返回前台后重试"); return }
    pending = promise
    audioOnly = onlyAudio
    try { activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = if (onlyAudio) "audio/*" else "*/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 4210) }
    catch (e: Exception) { pending = null; promise.reject("AUDIO_PICKER", e) }
  }
  @ReactMethod fun releaseAudio(uri: String, promise: Promise) {
    try {
      val file = File(Uri.parse(uri).path ?: "").canonicalFile
      require(file.parentFile == context.cacheDir.canonicalFile && file.name.startsWith("import-"))
      file.delete(); promise.resolve(null)
    } catch (e: Exception) { promise.reject("AUDIO_IMPORT_CLEANUP", e) }
  }
}
