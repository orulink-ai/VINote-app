import { mcpTextResult, translationArguments, translationFields } from '../src/lib/mcpTranslation'
import type { MCPTool, MCPRun } from '../src/lib/mcp'
import type { Note } from '../src/types/api'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
const tool = { inputSchema: { properties: { text: { type: 'string' }, target: { type: 'string', enum: ['en', 'zh'] }, limit: { type: 'number' } } } } as MCPTool
const note = { content: '# 正文\n全文', workspace_revision: 3 } as Note
it('maps only fields actually declared by the selected MCP tool and preserves the full source', () => {
  expect(translationFields(tool)).toEqual(['text', 'target'])
  expect(translationArguments(tool, 'text', 'target', 'en', note, {})).toEqual({ text: note.content, target: 'en' })
  expect(() => translationArguments(tool, 'content', 'target', 'en', note, {})).toThrow('工具声明')
  expect(() => translationArguments(tool, 'text', 'text', 'en', note, {})).toThrow('分别选择')
})
it('rejects unsupported languages, incompatible enums and oversized content without truncating', () => {
  expect(() => translationArguments(tool, 'text', 'target', 'ja', note, {})).toThrow('仅支持')
  const incompatible = { ...tool, inputSchema: { properties: { text: { type: 'string' }, target: { type: 'string', enum: ['English'] } } } }
  expect(() => translationArguments(incompatible, 'text', 'target', 'en', note, {})).toThrow('不兼容')
  expect(() => translationArguments(tool, 'text', 'target', 'zh', { ...note, content: 'a'.repeat(60001) }, {})).toThrow('不会截断')
})
it('never saves error results or interprets arbitrary resource/image payloads as translated text', () => {
  const run = { status: 'succeeded', result: { content: [{ type: 'text', text: 'Translation' }, { type: 'image', data: 'ignored' }] } } as unknown as MCPRun
  expect(mcpTextResult(run)).toBe('Translation')
  expect(mcpTextResult({ ...run, result: { ...run.result, isError: true } })).toBe('')
  expect(mcpTextResult({ ...run, status: 'unknown' })).toBe('')
  expect(mcpTextResult({ ...run, result: { ...run.result, truncated: true } })).toBe('')
})
