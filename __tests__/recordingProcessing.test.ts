import { acquireRecordingLock } from '../src/features/recording/recordingProcessing'

test('serializes operations per owner and recording and releases idempotently', () => {
  const release = acquireRecordingLock('alice', 'meeting-1')
  expect(() => acquireRecordingLock('alice', 'meeting-1')).toThrow('正在处理中')
  const releaseOtherOwner = acquireRecordingLock('bob', 'meeting-1')
  const releaseOtherRecording = acquireRecordingLock('alice', 'meeting-2')
  release()
  release()
  const releaseAgain = acquireRecordingLock('alice', 'meeting-1')
  releaseAgain()
  releaseOtherOwner()
  releaseOtherRecording()
})
