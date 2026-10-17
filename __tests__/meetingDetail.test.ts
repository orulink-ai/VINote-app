import { formatSpeakerOffset, transcriptChapters } from '../src/lib/meetingDetail'
test('uses recorded chunk offsets, never derives wall clock or invents sentence times', () => {
  expect(transcriptChapters('[录音第 0 分钟起]\n开场\n\n[录音第 1 分钟起]\n讨论')).toEqual([
    { seconds: 0, text: '开场\n\n' }, { seconds: 60, text: '讨论' },
  ])
  expect(transcriptChapters('没有时间戳的整段文字')).toEqual([])
})

test('subsecond speaking intervals stay distinct and minute boundaries stay valid', () => {
  expect(formatSpeakerOffset(47.7)).not.toEqual(formatSpeakerOffset(47.9))
  expect(formatSpeakerOffset(59.96)).toBe('0:59.9')
  expect(formatSpeakerOffset(60.01)).toBe('1:00.0')
})
