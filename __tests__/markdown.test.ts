import { markdownPreview, omitDuplicateTitle } from '../src/lib/markdown'
import { noteOrigin } from '../src/lib/noteOrigin'
test('only hides the first heading when it matches the displayed title', () => {
  const source = '# **市场会议**\n\n## 结论\n\n- 内容'
  expect(omitDuplicateTitle(source, '市场会议')).toBe('## 结论\n\n- 内容')
  expect(omitDuplicateTitle(source, '另一场会议')).toBe(source)
  expect(omitDuplicateTitle('## 会议\n正文', '会议')).toBe('正文')
  expect(omitDuplicateTitle('**会议**\n\n正文', '会议')).toBe('正文')
  expect(omitDuplicateTitle('## 会议安排\n正文', '会议')).toBe('## 会议安排\n正文')
  expect(omitDuplicateTitle('# 会议\n', '会议')).toBe('# 会议\n')
})
test('markdown preview removes formatting but preserves actual hashes and text', () => {
  expect(markdownPreview('# 会议\n\n**决定**：使用 C#\n\n- [文档](https://example.com)')).toBe('会议 决定：使用 C# 文档')
  expect(noteOrigin('mobile')).toBe('App 生成')
  expect(noteOrigin(null)).toBe('来源未知')
})


test('preview hides screenshot artifacts and URL fragments without changing the source', () => {
  const source = '会议结论\n\n[[Screenshot:00:09]]\n\n![Screenshot 00:09](/api/tasks/t/frame.jpg)\n\n[参考文档](https://example.com/doc)\n\n[待补链接](https://example.com/unfinished'
  expect(markdownPreview(source)).toBe('会议结论 参考文档 待补链接')
  expect(source).toContain('[[Screenshot:00:09]]')
  expect(markdownPreview('[Screenshot 00:09](/api/frame.jpg) 保留 C# 与 [预算]，时间 00:09')).toBe('保留 C# 与 [预算]，时间 00:09')
})
