package com.vinoteapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Keeps the user-started ASR/summary pipeline alive while Android allows it. */
class MeetingProcessingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
      NotificationChannel("meeting_processing", "会议纪要处理", NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "meeting_processing")
      else Notification.Builder(this)
    val notification = builder
      .setSmallIcon(android.R.drawable.ic_menu_upload)
      .setContentTitle("VINote 正在生成会议纪要")
      .setContentText("已完成进度会保留；点击返回查看")
      .setContentIntent(open).setOngoing(true).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(4202, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(4202, notification)
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }
}

class MeetingProcessing(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MeetingProcessing"

  @ReactMethod fun start(promise: Promise) {
    try {
      val intent = Intent(context, MeetingProcessingService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("MEETING_BACKGROUND", "无法启动后台处理；请在前台完成或稍后继续", error)
    }
  }

  @ReactMethod fun stop(promise: Promise) {
    context.stopService(Intent(context, MeetingProcessingService::class.java))
    promise.resolve(null)
  }
}
