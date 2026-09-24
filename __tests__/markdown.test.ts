import { markdownPreview } from '../src/lib/markdown'
import { noteOrigin } from '../src/lib/noteOrigin'
test('markdown preview removes formatting but preserves actual hashes and text', () => {
  expect(markdownPreview('# 会议\n\n**决定**：使用 C#\n\n- [文档](https://example.com)')).toBe('会议 决定：使用 C# 文档')
  expect(noteOrigin('mobile')).toBe('App 生成')
  expect(noteOrigin(null)).toBe('来源未知')
})
