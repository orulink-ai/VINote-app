package com.vinoteapp

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.MessageDigest

/** Launches the Android installer only for an update signed by the installed app. */
class ApkUpdateModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  override fun getName() = "ApkUpdate"
  override fun getConstants(): Map<String, Any> = mapOf("applicationId" to app.packageName)

  private fun flags(): Int = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
  private fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  private fun signers(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") info.signatures
    return signatures?.map { sig -> MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) } }?.toSet() ?: emptySet()
  }

  @ReactMethod
  fun installVerifiedUpdate(path: String, promise: Promise) {
    try {
      val expected = File(app.cacheDir, "vinote-updates/update.apk").canonicalFile
      val file = File(path).canonicalFile
      require(file == expected && file.isFile && file.length() > 0) { "更新包不存在或路径无效" }
      val pm = app.packageManager
      @Suppress("DEPRECATION") val archive = pm.getPackageArchiveInfo(file.path, flags()) ?: throw IllegalArgumentException("无法读取更新包")
      @Suppress("DEPRECATION") val installed = pm.getPackageInfo(app.packageName, flags())
      require(validApkUpdate(archive.packageName, version(archive), signers(archive), app.packageName, version(installed), signers(installed))) {
        "更新包的应用标识、版本或签名与当前应用不匹配"
      }
      if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
        promise.resolve("permission_required")
        return
      }
      val uri = FileProvider.getUriForFile(app, "${app.packageName}.vinote-updates", file)
      val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      app.startActivity(intent)
      promise.resolve("installer_opened")
    } catch (error: Exception) { promise.reject("APK_INSTALL_FAILED", error.message, error) }
  }

  @ReactMethod
  fun openInstallPermissionSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < 26) { promise.resolve(false); return }
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      app.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) { promise.reject("APK_PERMISSION_SETTINGS_FAILED", error.message, error) }
  }
}
