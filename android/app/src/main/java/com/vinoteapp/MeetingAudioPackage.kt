package com.vinoteapp
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
class MeetingAudioPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(MeetingAudioModule(context), MeetingSpeakers(context), RecordingBackground(context), MeetingFiles(context), MeetingProcessing(context), VINoteASRTransport(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
