import { Platform } from 'react-native'
import FS from 'react-native-fs'

export function meetingWavCachePath(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined

  // The native iOS converter and speaker reader use NSTemporaryDirectory.
  const directory = Platform.OS === 'ios' ? FS.TemporaryDirectoryPath : FS.CachesDirectoryPath
  if (!directory) return undefined

  const path = uri.slice('file://'.length)
  const prefix = `${directory.replace(/\/+$/, '')}/asr-`
  if (!path.startsWith(prefix) || !/^[a-f0-9-]+\.wav$/i.test(path.slice(prefix.length))) return undefined
  return path
}
