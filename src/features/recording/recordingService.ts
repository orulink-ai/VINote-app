import { PermissionsAndroid, Platform } from 'react-native'
import Sound from 'react-native-nitro-sound'

export async function requestRecordingPermission() {
  if (Platform.OS !== 'android') return true
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: '麦克风权限', message: 'VINote 需要麦克风来录制会议语音。',
    buttonPositive: '允许', buttonNegative: '拒绝',
  })
  return result === PermissionsAndroid.RESULTS.GRANTED
}

export async function startRecording() {
  const allowed = await requestRecordingPermission()
  if (!allowed) throw new Error('请允许 VINote 使用麦克风')
  return Sound.startRecorder(undefined, { AudioSamplingRate: 44100, AudioEncodingBitRate: 128000, AudioChannels: 1 })
}

export async function stopRecording() {
  const path = await Sound.stopRecorder()
  Sound.removeRecordBackListener()
  return path.startsWith('file://') ? path : `file://${path}`
}

export function listenRecording(onTick: (milliseconds: number) => void) {
  Sound.addRecordBackListener(event => onTick(event.currentPosition))
  return () => Sound.removeRecordBackListener()
}
