import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { MCPScreen } from '../src/screens/MCPScreen'
import { mcpApi } from '../src/lib/mcp'
import { persistMCPIntent, recoverMCPIntent } from '../src/lib/mcpTranslation'
import { readAccountId } from '../src/lib/storage'
import { getNote, editNoteContent } from '../src/lib/notes'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/mcp', () => ({ mcpApi: jest.fn(), runLabels: { awaiting_confirmation: '待确认', failed: '失败', unknown: '待核验' } }))
jest.mock('../src/lib/notes', () => ({ getNote: jest.fn(), editNoteContent: jest.fn() }))
jest.mock('../src/lib/workspace', () => ({ syncWorkspace: jest.fn(async () => {}) }))
jest.mock('../src/lib/mcpTranslation', () => ({
  ...jest.requireActual('../src/lib/mcpTranslation'),
  recoverMCPIntent: jest.fn(async () => null), clearMCPIntent: jest.fn(async () => {}), persistMCPIntent: jest.fn(async () => {}),
}))
const connection = { id: 'official', name: 'VINote 云翻译', managed: true, providerId: 'vinote-cloud-translation', authType: 'vinote-session', url: 'https://supabase-vinote.orulink.ai/vinote-api/api/mcp-first-party/translation', enabled: true, status: 'connected' }
const tool = { name: 'vinote_translate_text', enabled: false, description: 'Translate', inputSchema: { type: 'object', additionalProperties: false, required: ['text', 'target_language'], properties: { text: { type: 'string' }, model: { type: 'string' }, target_language: { type: 'string', enum: ['zh', 'en'] } } } }
const models = { models: [{ id: 'test-model', modelType: 'llm', runtimeStatus: 'available' }], defaultModel: null }
const note = { id: 'workspace-note', workspace_key: 'note', workspace_revision: 3, title: '验收', content: '# Test\n\nExplicit source.', source_type: 'text' }
const press = (view: Renderer.ReactTestRenderer, title: string) => view.root.findAll(node => node.props.title === title && typeof node.props.onPress === 'function')[0].props.onPress()

beforeEach(() => { jest.clearAllMocks(); jest.mocked(recoverMCPIntent).mockResolvedValue(null); jest.mocked(readAccountId).mockResolvedValue('owner') })

test('official connection discovers but does not grant or invoke until explicit steps', async () => {
  let provisioned = false
  jest.mocked(mcpApi).mockImplementation(async (path, init) => {
    if (path === '') return { connections: provisioned ? [connection] : [] } as never
    if (path.startsWith('/runs')) return { runs: [] } as never
    if (path === '/first-party/translation') { provisioned = true; return { connection, provider: { configured: true } } as never }
    if (path === '/first-party/translation/models') return models as never
    if (path === '/official/discover') return { connection, tools: [tool] } as never
    if (path === '/official/tools' && init?.method === 'PATCH') return { ...tool, enabled: true } as never
    if (path === '/official/invoke') return { id: 'run', status: 'awaiting_confirmation', confirmationToken: 'bound' } as never
    throw new Error(`Unexpected path: ${path}`)
  })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MCPScreen note={note as never} onBack={jest.fn()} />) })
  await act(async () => { await press(view, '连接与授权') })
  await act(async () => { await press(view, '连接云翻译') })
  expect(mcpApi).toHaveBeenCalledWith('/first-party/translation', { method: 'POST', body: '{}' }, 'owner')
  expect(jest.mocked(mcpApi).mock.calls.some(([path]) => path.includes('/invoke') || path === '/official/tools')).toBe(false)
  expect(view.root.findAll(node => node.props.title === '预览翻译' && typeof node.props.onPress === 'function')[0].props.disabled).toBe(true)
  await act(async () => { await press(view, '允许此工具翻译正文') })
  expect(view.root.findAll(node => node.props.title === '预览翻译' && typeof node.props.onPress === 'function')[0].props.disabled).toBe(true)
  await act(async () => { await press(view, 'test-model') })
  await act(async () => { await press(view, '完成，返回翻译') })
  await act(async () => { await press(view, '预览翻译') })
  const sheets = view.root.findAll(node => node.props.visible === true && typeof node.props.onClose === 'function')
  expect(sheets.filter(node => node.props.title === '翻译连接与授权')).toHaveLength(0)
  expect(sheets.filter(node => node.props.title === '全文翻译')).toHaveLength(1)
  expect(view.root.findAll(node => node.props.accessibilityLabel === '翻译工具其他 JSON 参数')).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('查看所选原文')
  expect(JSON.stringify(view.toJSON())).not.toContain('additionalProperties')
  const request = jest.mocked(mcpApi).mock.calls.find(([path]) => path === '/official/invoke')!
  expect(JSON.parse(String(request[1]?.body))).toEqual(expect.objectContaining({ arguments: { text: note.content, target_language: 'en', model: 'test-model' } }))
  expect(JSON.parse(String(request[1]?.body)).confirmed).toBeUndefined()
  expect(persistMCPIntent).toHaveBeenCalled()
  await act(async () => view.unmount())
})

test.each(['failed', 'unknown'] as const)('recovered %s call remains inspectable without another execute', async status => {
  const original = { requestId: 'original', connectionId: connection.id, toolName: tool.name, arguments: { text: note.content, target_language: 'en' }, source: note, run: { id: 'original-run', status, error: { message: '模型暂不可用' } } }
  jest.mocked(recoverMCPIntent).mockResolvedValue(original as never)
  jest.mocked(mcpApi).mockImplementation(async path => {
    if (path === '') return { connections: [connection] } as never
    if (path === '/runs?limit=50&offset=0') return { runs: [] } as never
    if (path === '/official/tools') return { tools: [{ ...tool, enabled: true }] } as never
    if (path === '/first-party/translation/models') return models as never
    if (path === '/runs/by-request/original') return original.run as never
    throw new Error(`Unexpected path: ${path}`)
  })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MCPScreen note={note as never} onBack={jest.fn()} />) })
  expect(jest.mocked(mcpApi).mock.calls.some(([path]) => path.endsWith('/invoke'))).toBe(false)
  await act(async () => { await press(view, '查看原调用与结果') })
  expect(JSON.stringify(view.toJSON())).toContain('模型暂不可用')
  expect(view.root.findAll(node => node.props.title === '确认并执行一次')).toHaveLength(0)
  await act(async () => { await press(view, '刷新原调用状态') })
  expect(jest.mocked(mcpApi).mock.calls.some(([path]) => path.endsWith('/invoke'))).toBe(false)
  await act(async () => view.unmount())
})

test('unsupported public provider reports a recoverable error without granting or invoking', async () => {
  jest.mocked(mcpApi).mockImplementation(async path => {
    if (path === '') return { connections: [] } as never
    if (path.startsWith('/runs')) return { runs: [] } as never
    throw new Error('404 Not Found')
  })
  const back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MCPScreen onBack={back} />) })
  await act(async () => { await press(view, '连接云翻译') })
  expect(JSON.stringify(view.toJSON())).toContain('当前共享服务尚未提供云翻译')
  expect(jest.mocked(mcpApi).mock.calls.some(([path]) => path.includes('/invoke') || path.includes('/discover'))).toBe(false)
  await act(async () => view.unmount())
})

test('failed tool reading offers reading again without falsely requesting a definition update', async () => {
  jest.mocked(mcpApi).mockImplementation(async path => {
    if (path === '') return { connections: [connection] } as never
    if (path.startsWith('/runs')) return { runs: [] } as never
    if (path === '/official/tools') throw new Error('工具读取暂不可用')
    throw new Error(`Unexpected path: ${path}`)
  })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MCPScreen note={note as never} onBack={jest.fn()} />) })
  await act(async () => { await press(view, '连接与授权') })
  expect(JSON.stringify(view.toJSON())).toContain('工具读取暂不可用')
  expect(view.root.findAll(node => node.props.title === '更新翻译工具定义')).toHaveLength(0)
  expect(view.root.findAll(node => node.props.title === '读取翻译工具').length).toBeGreaterThan(0)
  expect(jest.mocked(mcpApi).mock.calls.some(([path]) => path.includes('/discover') || path.includes('/invoke'))).toBe(false)
  await act(async () => view.unmount())
})

test.each([false, true])('save binds original owner; account switched during read = %s', async switched => {
  const run = { id: 'completed-run', status: 'succeeded', result: { content: [{ type: 'text', text: '# Translated\n\nFull text.' }] } }
  const original = { requestId: 'completed', connectionId: connection.id, toolName: tool.name, arguments: { text: note.content, target_language: 'en', model: 'test-model' }, source: note, run }
  jest.mocked(recoverMCPIntent).mockResolvedValue(original as never)
  jest.mocked(mcpApi).mockImplementation(async path => {
    if (path === '') return { connections: [connection] } as never
    if (path === '/runs?limit=50&offset=0') return { runs: [] } as never
    if (path === '/official/tools') return { tools: [{ ...tool, enabled: true }] } as never
    if (path === '/first-party/translation/models') return models as never
    if (path === '/runs/by-request/completed') return run as never
    throw new Error(`Unexpected path: ${path}`)
  })
  jest.mocked(getNote).mockImplementation(async () => { if (switched) jest.mocked(readAccountId).mockResolvedValue('other-owner'); return note as never })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<MCPScreen note={note as never} onBack={jest.fn()} />) })
  await act(async () => { await press(view, '查看原调用与结果') })
  await act(async () => { await press(view, '保存译文为新版本') })
  if (switched) {
    expect(editNoteContent).not.toHaveBeenCalled()
    expect(persistMCPIntent).not.toHaveBeenCalledWith('other-owner', expect.anything())
    expect(JSON.stringify(view.toJSON())).not.toContain('已保存译文')
  } else expect(editNoteContent).toHaveBeenCalledWith(note.id, '# Translated\n\nFull text.', note, 'owner')
  expect(jest.mocked(mcpApi).mock.calls.some(([path]) => path.endsWith('/invoke'))).toBe(false)
  await act(async () => view.unmount())
})
