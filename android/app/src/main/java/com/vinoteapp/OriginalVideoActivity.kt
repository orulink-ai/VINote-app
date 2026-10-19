package com.vinoteapp

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView

/** Platform decoder/seek controls read the complete file without JS/base64 copies. */
class OriginalVideoActivity : Activity() {
  companion object {
    internal var current: OriginalVideoActivity? = null
    internal val authority = OriginalLifecycle()
  }
  private lateinit var video: VideoView
  private var position = 0
  private var resume = true
  private var path = ""
  internal fun authorized() = authority.valid(intent.getStringExtra("ticket"), intent.getStringExtra("owner"))
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    try {
      require(authorized())
      val source = originalMedia(this, intent.getStringExtra("uri") ?: "", intent.getStringExtra("owner") ?: "")
      require(source.extension.lowercase() in setOf("mp4", "mov", "mkv", "webm", "avi", "m4v"))
      val seconds = intent.getDoubleExtra("seconds", 0.0)
      require(seconds.isFinite() && seconds in 0.0..86400.0)
      path = source.path
      position = state?.getInt("position") ?: (seconds * 1000).toInt()
      current?.finish(); current = this
      video = VideoView(this)
      val frame = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
      frame.addView(video, FrameLayout.LayoutParams(-1, -1, android.view.Gravity.CENTER))
      setContentView(frame)
      val controls = MediaController(this)
      controls.setAnchorView(video); video.setMediaController(controls)
      video.setOnPreparedListener { player ->
        if (!authorized()) { video.stopPlayback(); finish() }
        else {
          video.seekTo(position.coerceIn(0, player.duration.coerceAtLeast(0)))
          if (resume) video.start()
          controls.show(5000)
        }
      }
      video.setOnErrorListener { _, _, _ ->
        Toast.makeText(this, "此设备无法播放该视频格式，原文件仍可导出", Toast.LENGTH_LONG).show()
        finish(); true
      }
    } catch (_: Exception) { finish() }
  }
  override fun onStart() {
    super.onStart()
    if (!authorized()) { finish(); return }
    if (::video.isInitialized) video.setVideoPath(path)
  }
  override fun onStop() {
    if (::video.isInitialized) { position = video.currentPosition; resume = video.isPlaying; video.stopPlayback() }
    super.onStop()
  }
  override fun onSaveInstanceState(out: Bundle) { if (::video.isInitialized) out.putInt("position", video.currentPosition); super.onSaveInstanceState(out) }
  override fun onDestroy() { if (current === this) current = null; if (::video.isInitialized) video.stopPlayback(); super.onDestroy() }
}
