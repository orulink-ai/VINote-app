import { recordingTitle, summaryTopic, displayRecordingTitle, recordingDisplayName, meetingDisplayName } from '../src/features/recording/recordingTitle'

test('legacy AI titles display as recordings while manual titles stay intact', () => {
  const record = { title: '自动生成的会议纪要', createdAt: '2026-11-09T10:02:00+08:00', titleSource: 'ai' as const }
  expect(recordingDisplayName(record)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  expect(recordingDisplayName({ ...record, source: 'import' })).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}｜导入音频$/)
  expect(recordingDisplayName({ ...record, source: 'import', createdAt: '' })).toBe('导入时间未记录')
  expect(recordingDisplayName({ ...record, titleSource: 'manual' })).toBe(record.title)
})

test('meeting list follows desktop: user title, minutes topic, then capture time', () => {
  const record = { title: '自动生成的会议纪要', createdAt: '2026-11-09T10:02:00+08:00', titleSource: 'ai' as const }
  expect(meetingDisplayName(record, '2026-11-09 10:02｜产品评审')).toBe('产品评审')
  expect(meetingDisplayName({ ...record, titleSource: 'manual', title: '自定义会议' }, '2026-11-09 10:02｜产品评审')).toBe('自定义会议')
  expect(meetingDisplayName(record, '待生成纪要')).toBe(recordingDisplayName(record))
  expect(recordingDisplayName({ ...record, createdAt: '' })).toBe('录制时间未记录')
})

test('list titles hide a duplicated recording time while preserving a different topic date', () => {
  expect(displayRecordingTitle('2026-11-09 19:03｜2026-11-09 19:03 导入录音例会纪要')).toBe('导入录音例会纪要')
  expect(displayRecordingTitle('2026-11-09 19:03｜2026-11-10 会议安排')).toBe('2026-11-10 会议安排')
  expect(displayRecordingTitle('普通标题')).toBe('普通标题')
})

test.each(['', 'invalid', 'not-a-time'])('invalid recorded time %s never invents the current date', value => {
  expect(recordingTitle(value, '真实主题')).toBe('时间未知｜真实主题')
})
test('actual supplied timestamp and generated heading are used without a model request', () => {
  const title = recordingTitle('2026-10-12T06:58:47+08:00', '真实主题')
  const date = new Date('2026-10-12T06:58:47+08:00')
  // Titles use the device's calendar date, which can differ from the timestamp's
  // original +08:00 date (the UTC runner sees the previous evening).
  const calendarDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  expect(title).toContain(calendarDate)
  expect(title).toContain('｜真实主题')
  expect(summaryTopic('# **真实主题**\n正文')).toBe('真实主题')
  expect(summaryTopic('# 会议纪要\n正文')).toBeUndefined()
})
test('removes an identical recording timestamp repeated by a generated heading', () => {
  const date = '2026-10-12T06:58:47+08:00'
  const prefix = recordingTitle(date, '会议').split('｜')[0]
  expect(recordingTitle(date, `${prefix} 导入录音例会纪要`)).toBe(`${prefix}｜导入录音例会纪要`)
  expect(recordingTitle(date, '2026-10-20 16:14 发布计划')).toContain('2026-10-20 16:14 发布计划')
})

test.each(['｜', '|'])('summary topic removes leading VINote timestamp prefixes before truncation: %s', separator => {
  const topic = '海口项目的业务方案与技术落地讨论'.repeat(3)
  expect(summaryTopic(`# 2026-10-15 16:14${separator}2026-10-15 16:14｜${topic}\n正文`)).toBe(topic.slice(0, 30))
})

test.each(['2026-10-15 项目回顾', '2026-10-15 16:14 项目回顾', '海口2026-10-15 16:14｜项目回顾'])('ordinary or embedded topic dates remain intact: %s', topic => {
  expect(summaryTopic(`# ${topic}\n正文`)).toBe(topic)
})

test('date inside the actual topic is preserved after removing the recording prefix', () => {
  expect(summaryTopic('# **2026-10-15 16:14｜2026-10-20 发布计划**\n正文')).toBe('2026-10-20 发布计划')
})

test.each(['', '没有一级标题', '# ', '# 会议纪要', '# 初稿', '# 会议总结：讨论',
  '# 2026-10-15 16:14｜', '# 2026-10-15 16:14|会议纪要'])('empty and generic topic compatibility: %s', content => {
  expect(summaryTopic(content)).toBeUndefined()
})
