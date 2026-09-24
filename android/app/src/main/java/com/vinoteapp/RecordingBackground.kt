package com.vinoteapp

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.facebook.react.bridge.*

/** 前台服务维持后台麦克风采集优先级，不自动重启录音。 */
class RecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("recording", "会议录音", NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = Notification.Builder(this, "recording").setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("VINote 正在录音").setContentText("切换应用或锁屏可继续录音；点击返回结束并保存")
      .setContentIntent(open).setOngoing(true).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(4201, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    else startForeground(4201, notification)
    return START_NOT_STICKY
  }
}
class RecordingBackground(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "RecordingBackground"
  @ReactMethod fun start(promise: Promise) {
    try { context.startForegroundService(Intent(context, RecordingService::class.java)); promise.resolve(null) }
    catch (e: Exception) { promise.reject("RECORDING_BACKGROUND", "无法启动后台录音，请返回前台重试", e) }
  }
  @ReactMethod fun stop(promise: Promise) {
    context.stopService(Intent(context, RecordingService::class.java)); promise.resolve(null)
  }
}
