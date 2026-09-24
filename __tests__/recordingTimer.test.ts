import { recordingElapsedSeconds } from '../src/features/recording/recordingTimer'

test('recording timer uses elapsed wall time and never becomes negative or moves backward', () => {
  expect(recordingElapsedSeconds(1000, 900, 0)).toBe(0)
  expect(recordingElapsedSeconds(1000, 4500, 0)).toBe(3)
  expect(recordingElapsedSeconds(1000, 3000, 3)).toBe(3)
})
