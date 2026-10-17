import { markdownPreview } from '../src/lib/markdown'
import { noteOrigin } from '../src/lib/noteOrigin'
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
