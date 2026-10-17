import { acquireGenerationSlot, acquireRecordingLock } from '../src/features/recording/recordingProcessing'

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

test('limits complete generation across records and accounts without blocking record reads', () => {
  const release = acquireGenerationSlot()
  expect(() => acquireGenerationSlot()).toThrow('已有录音正在整理')
  const releaseRecord = acquireRecordingLock('bob', 'meeting-2')
  releaseRecord()
  release(); release()
  acquireGenerationSlot()()
})
