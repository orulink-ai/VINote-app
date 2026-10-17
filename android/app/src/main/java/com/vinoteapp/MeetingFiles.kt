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

/** 选择器先复制到自有缓存，不持久化第三方 content URI。 */
class MeetingFiles(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null
  private var audioOnly = true
  private val worker = Executors.newSingleThreadExecutor()
  override fun getName() = "MeetingFiles"
  init { context.addActivityEventListener(object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != 4210) return
      val promise = pending ?: return
      val validateAudio = audioOnly
      pending = null
      val uri = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return }
      worker.execute {
        val target = File(context.cacheDir, "import-${UUID.randomUUID()}")
        try {
          var name = "audio.m4a"
          context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
          }
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
    if (activity == null || pending != null) { promise.reject("AUDIO_PICKER", "请返回前台后重试"); return }
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
