import { submissionPercent } from '../src/lib/asrProgress'
import { analysisProgress } from '../src/features/recording/analysisProgress'

test('full submission remains running at 99%, independent of zero durable coverage', () => {
  const value = { duration: 78, submittedSeconds: 78, confirmedSeconds: 0 }
  expect(submissionPercent(value)).toBe(99)
  expect(analysisProgress({ owner: 'A', recordId: 'r', asrProgress: value, text: '转写：提交识别的音频 78/78 秒\n说话人：本机分析 42%' })).toEqual({ transcription: { status: 'running', percent: 99 }, speaker: { status: 'running', percent: 42 } })
})
test('legacy percent or processed text cannot manufacture typed submission coverage', () => {
  expect(analysisProgress({ owner: 'A', recordId: 'r', transcriptionPercent: 100, text: '转写：转写进度 100% · 已识别\n说话人：本机分析 42%' })?.transcription).toEqual({ status: 'preparing', percent: undefined })
})
test.each([NaN, Infinity, -1, 101])('invalid measurement %s stays unknown', submittedSeconds => {
  expect(submissionPercent({ duration: 100, submittedSeconds, confirmedSeconds: 0 })).toBeUndefined()
})
