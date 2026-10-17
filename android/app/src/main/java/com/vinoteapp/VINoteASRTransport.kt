package com.vinoteapp

import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.network.OkHttpClientProvider

/** Actual bridge field writer; executable on the JVM with collecting writers. */
internal fun writeASREventFields(id: String, type: String, number: Int?, data: String?,
  putString: (String, String) -> Unit, putInt: (String, Int) -> Unit) {
  putString("id", id); putString("type", type)
  if (type == "peerClosing" && number != null) putInt("code", if (number in 1000..4999) number else 1006)
  if (type == "error" && number != null) putInt("category", if (number in 0..10) number else 0)
  if (type == "message" && data != null) putString("data", data)
}

/** Thin Android bridge; the production socket core is exercised with real loopback WebSockets. */
class VINoteASRTransport(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val core = ASRSocketCore(BuildConfig.VINOTE_ASR_ORIGIN, OkHttpClientProvider.getOkHttpClient()) { id, type, category, data ->
    if (context.hasActiveReactInstance()) context.emitDeviceEvent("VINoteASRTransport", Arguments.createMap().apply {
      writeASREventFields(id, type, category, data, { key, value -> putString(key, value) }, { key, value -> putInt(key, value) })
    })
  }
  override fun getName() = "VINoteASRTransport"
  override fun getConstants(): MutableMap<String, Any> = mutableMapOf("protocolVersion" to 1)
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
  private fun result(promise: Promise) = object : ASRSocketResult {
    override fun success(queueBytes: Long?) {
      if (queueBytes == null) promise.resolve(null)
      else promise.resolve(Arguments.createMap().apply { putBoolean("accepted", true); putDouble("queueBytes", queueBytes.toDouble()) })
    }
    override fun failure(category: Int) { promise.reject("ASR_TRANSPORT_$category", "ASR transport failed; original retained") }
  }
  @ReactMethod fun connect(id: String, url: String, token: String, expectedBytes: Double, promise: Promise) {
    if (!expectedBytes.isFinite() || expectedBytes != expectedBytes.toLong().toDouble()) result(promise).failure(10)
    else core.connect(id, url, token, expectedBytes.toLong(), result(promise))
  }
  @ReactMethod fun enqueue(id: String, data: String, binary: Boolean, promise: Promise) {
    try {
      require(data.length <= if (binary) 8560 else 4096)
      if (binary) core.enqueue(id, null, Base64.decode(data, Base64.NO_WRAP), result(promise))
      else {
        require(org.json.JSONObject(data).getString("type") == "session.start")
        core.enqueue(id, data, null, result(promise))
      }
    } catch (_: Exception) { result(promise).failure(10) }
  }
  @ReactMethod fun close(id: String, promise: Promise) = core.close(id, result(promise))
  override fun invalidate() { core.invalidate(); super.invalidate() }
}
