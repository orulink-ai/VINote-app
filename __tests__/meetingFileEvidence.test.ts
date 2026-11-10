import { meetingFileEvidence } from '../src/lib/meetingFileEvidence'
test('keeps provider timing and speaker groups without claiming a real identity', () => {
  const evidence = meetingFileEvidence({ text: '完整转写', segments: [
    { start: 1, end: 2.5, text: '你好', speakerId: 'alpha', speakerLabel: '张三' },
    { start: 3, end: 4, text: '收到', speakerId: 'beta' },
    { start: 5, end: 6, text: '继续', speakerId: 'alpha' },
  ] })
  expect(evidence).toContain('1.00–2.50 秒 · 说话人 1')
  expect(evidence).toContain('3.00–4.00 秒 · 说话人 2')
  expect(evidence).toContain('5.00–6.00 秒 · 说话人 1')
  expect(evidence).not.toContain('张三')
  expect(evidence).toContain('不代表真实身份')
})
test('keeps the full transcript and marks missing speaker information as unknown', () => {
  const evidence = meetingFileEvidence({ text: '完整转写', segments: [] })
  expect(evidence).toContain('完整转写')
  expect(evidence).toContain('说话人待确认')
})
test('does not identify unknown, overlapping or unverified speaker windows as people', () => {
  const evidence = meetingFileEvidence({ text: '完整转写', segments: [
    { start: 0, end: 1, text: '未知', speakerId: 'speaker_unknown' },
    { start: 1, end: 2, text: '重叠', speakerId: 'speaker_overlap' },
    { start: 2, end: 3, text: '待核验', speakerId: 'speaker_window_1' },
    { start: 3, end: 4, text: '明确', speakerId: 'speaker_1' },
  ] })
  expect(evidence).toContain('说话人待确认：未知')
  expect(evidence).toContain('重叠发言 · 归属待确认：重叠')
  expect(evidence).toContain('说话人待确认：待核验')
  expect(evidence).toContain('说话人 1：明确')
})
