import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import Sound from 'react-native-nitro-sound'
import { isRecordingActive, startRecording, stopRecording } from '../src/features/recording/recordingService'

jest.mock('react-native-nitro-sound', () => ({ __esModule: true, default: {
  stopPlayer: jest.fn(async () => {}),
  startRecorder: jest.fn(async () => '/test.m4a'),
  stopRecorder: jest.fn(async () => '/test.m4a'),
  removeRecordBackListener: jest.fn(),
} }))

const platform = Object.getOwnPropertyDescriptor(Platform, 'OS')!
beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  NativeModules.RecordingBackground = { start: jest.fn(async () => {}), stop: jest.fn(async () => {}) }
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
})
afterEach(() => { jest.restoreAllMocks(); Object.defineProperty(Platform, 'OS', platform) })

test('cancelled permission result never starts recording or the foreground service', async () => {
  let permission!: (value: typeof PermissionsAndroid.RESULTS.GRANTED) => void
  jest.spyOn(PermissionsAndroid, 'request').mockImplementationOnce(() => new Promise(resolve => { permission = resolve }))
  const controller = new AbortController()
  const task = startRecording('/test.m4a', controller.signal)
  const rejected = expect(task).rejects.toThrow('录音准备已取消')
  controller.abort()
  permission(PermissionsAndroid.RESULTS.GRANTED)
  await rejected
  expect(Sound.startRecorder).not.toHaveBeenCalled()
  expect(NativeModules.RecordingBackground.start).not.toHaveBeenCalled()
})

test('a late native recorder result is stopped before cancellation settles', async () => {
  let complete!: () => void
  jest.mocked(Sound.startRecorder).mockImplementationOnce(async () => { await new Promise<void>(resolve => { complete = resolve }); return '/test.m4a' })
  const controller = new AbortController()
  const task = startRecording('/test.m4a', controller.signal)
  const rejected = expect(task).rejects.toThrow('录音准备已取消')
  for (let step = 0; step < 10 && !complete; step++) await Promise.resolve()
  expect(complete).toBeDefined()
  controller.abort(); complete()
  await rejected
  expect(Sound.stopRecorder).toHaveBeenCalledTimes(1)
  expect(NativeModules.RecordingBackground.stop).toHaveBeenCalledTimes(1)
  expect(isRecordingActive()).toBe(false)
})

test('failed late release preserves active guard until explicit stop succeeds', async () => {
  const controller = new AbortController()
  jest.mocked(Sound.startRecorder).mockImplementationOnce(async () => { controller.abort(); return '/test.m4a' })
  jest.mocked(Sound.stopRecorder).mockRejectedValueOnce(new Error('native busy'))
  await expect(startRecording('/test.m4a', controller.signal)).rejects.toMatchObject({ name: 'RecordingReleaseError' })
  expect(isRecordingActive()).toBe(true)
  expect(NativeModules.RecordingBackground.stop).not.toHaveBeenCalled()
  await stopRecording()
  expect(isRecordingActive()).toBe(false)
})

test('failed native stop leaves the active recording and foreground service intact', async () => {
  await startRecording('/test.m4a')
  jest.mocked(Sound.stopRecorder).mockRejectedValueOnce(new Error('native busy'))
  await expect(stopRecording()).rejects.toThrow('native busy')
  expect(isRecordingActive()).toBe(true)
  expect(NativeModules.RecordingBackground.stop).not.toHaveBeenCalled()
  await stopRecording()
  expect(isRecordingActive()).toBe(false)
})
