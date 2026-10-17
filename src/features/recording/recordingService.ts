import { PermissionsAndroid, Platform, NativeModules } from 'react-native'
import Sound from 'react-native-nitro-sound'
let recordingActive = false
export const isRecordingActive = () => recordingActive

export async function requestRecordingPermission() {
  if (Platform.OS !== 'android') return true
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: '麦克风权限', message: 'VINote 需要麦克风来录制会议语音。',
    buttonPositive: '允许', buttonNegative: '拒绝',
  })
  return result === PermissionsAndroid.RESULTS.GRANTED
}

export async function startRecording(path: string, signal?: AbortSignal) {
  const checkCancelled = () => { if (signal?.aborted) throw new Error('录音准备已取消') }
  checkCancelled()
  const allowed = await requestRecordingPermission()
  checkCancelled()
  if (!allowed) throw new Error('请允许 VINote 使用麦克风')
  let backgroundStarted = false
  let recorderStarted = false
  try {
    if (Platform.OS === 'android') { await NativeModules.RecordingBackground.start(); backgroundStarted = true }
    checkCancelled()
    await Sound.stopPlayer().catch(() => {})
    checkCancelled()
    const result = await Sound.startRecorder(path.replace('file://', ''), { AudioSamplingRate: 44100, AudioEncodingBitRate: 128000, AudioChannels: 1 })
    recorderStarted = true
    checkCancelled()
    recordingActive = true
    return result
  } catch (error) {
    // A permission/native request may finish after Cancel. Release that late
    // capture before allowing another attempt, without claiming it was saved.
    if (recorderStarted) {
      try { await Sound.stopRecorder() }
      catch {
        // Keep the foreground service and active guard until an explicit Stop
        // succeeds. A failed release is not a completed cancellation.
        recordingActive = true
        const failure = new Error('无法确认麦克风已停止，请在录音控制中结束并保存。')
        failure.name = 'RecordingReleaseError'
        throw failure
      }
    }
    if (backgroundStarted) await NativeModules.RecordingBackground.stop().catch(() => {})
    throw error
  }
}

export async function stopRecording() {
  // A rejected native Stop cannot be treated as device release. Keep the
  // active guard/service until the user explicitly retries stopping.
  const path = await Sound.stopRecorder()
  recordingActive = false
  Sound.removeRecordBackListener()
  if (Platform.OS === 'android') await NativeModules.RecordingBackground.stop()
  return path.startsWith('file://') ? path : `file://${path}`
}

export async function pauseRecording() { await Sound.pauseRecorder() }
export async function resumeRecording() { await Sound.resumeRecorder() }

export function listenRecording(onTick: (milliseconds: number) => void) {
  Sound.addRecordBackListener(event => onTick(event.currentPosition))
  return () => Sound.removeRecordBackListener()
}
