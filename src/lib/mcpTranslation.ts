import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from './storage'
import type { Note } from '../types/api'
import type { MCPRun, MCPTool } from './mcp'

export type MCPIntent = { requestId: string; connectionId: string; toolName: string; arguments: Record<string, unknown>; source?: Note; run?: MCPRun; locallySaved?: boolean }
const key = (owner: string) => `vinote:${owner}:mcp-intent`
async function guard(owner: string) { if (await readAccountId() !== owner) throw new Error('账号已切换，原调用保留在原账号') }
export async function persistMCPIntent(owner: string, value: MCPIntent) { await guard(owner); await Storage.setItem(key(owner), JSON.stringify(value)); await guard(owner) }
export async function recoverMCPIntent(owner: string): Promise<MCPIntent | null> { await guard(owner); const value = await Storage.getItem(key(owner)); await guard(owner); return value ? JSON.parse(value) : null }
export async function clearMCPIntent(owner: string) { await guard(owner); await Storage.removeItem(key(owner)) }
export function translationFields(tool: MCPTool): string[] {
  const schema = tool.inputSchema as { properties?: Record<string, { type?: unknown }> }
  return Object.entries(schema.properties || {}).filter(([, value]) => value?.type === 'string').map(([name]) => name)
}
export function translationArguments(tool: MCPTool, textField: string, languageField: string, language: string, source: Note, extras: unknown, model?: string): Record<string, unknown> {
  const fields = translationFields(tool)
  if (!fields.includes(textField) || !fields.includes(languageField) || textField === languageField) throw new Error('请分别选择工具声明的正文和目标语言字段')
  if (!['en', 'zh'].includes(language)) throw new Error('仅支持中文和英文')
  if (!source.content.trim() || source.content.length > 60000) throw new Error('完整正文须为 1–60000 字符，不会截断发送')
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('其他参数必须是 JSON 对象')
  if (Object.keys(extras).length) throw new Error('全文翻译只发送正文与目标语言；其他参数请使用普通工具调用')
  const required = (tool.inputSchema as { required?: string[] }).required || []
  if (required.some(name => name !== textField && name !== languageField)) throw new Error('此工具还需要额外必填参数，暂不兼容全文翻译')
  const property = (tool.inputSchema as { properties: Record<string, { enum?: unknown[] }> }).properties[languageField]
  if (property.enum && !property.enum.includes(language)) throw new Error('此工具的语言编码与 zh/en 不兼容，请选择兼容的翻译工具')
  if (model !== undefined && (tool.name !== 'vinote_translate_text' || !fields.includes('model') || !model.trim() || model.length > 200)) throw new Error('请重新核验翻译工具，并选择可用模型')
  const args = { [textField]: source.content, [languageField]: language, ...(model ? { model } : {}) }
  const json = JSON.stringify(args)
  // Byte length is independent of JS UTF-16 length; Chinese often occupies 3 bytes.
  const bytes = encodeURIComponent(json).replace(/%[A-F\d]{2}/gi, 'x').length
  if (bytes > 64 * 1024) throw new Error('完整正文超过工具的 64 KiB 参数限制，不会截断发送')
  return args
}
export function mcpTextResult(run: MCPRun): string {
  if (run.status !== 'succeeded' || !run.result || (run.result as { isError?: boolean; truncated?: boolean }).isError || (run.result as { truncated?: boolean }).truncated) return ''
  const content = (run.result as { content?: Array<{ type: string; text?: string }> }).content
  return Array.isArray(content) ? content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n\n').trim() : ''
}
