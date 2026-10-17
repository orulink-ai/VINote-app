import { recordingTitle, summaryTopic } from '../src/features/recording/recordingTitle'

test.each(['', 'invalid', 'not-a-time'])('invalid recorded time %s never invents the current date', value => {
  expect(recordingTitle(value, '真实主题')).toBe('时间未知｜真实主题')
})
test('actual supplied timestamp and generated heading are used without a model request', () => {
  const title = recordingTitle('2026-10-12T06:58:47+08:00', '真实主题')
  const date = new Date('2026-10-12T06:58:47+08:00')
  expect(title).toContain(`${date.getFullYear()}-10-12`)
  expect(title).toContain('｜真实主题')
  expect(summaryTopic('# **真实主题**\n正文')).toBe('真实主题')
  expect(summaryTopic('# 会议纪要\n正文')).toBeUndefined()
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
