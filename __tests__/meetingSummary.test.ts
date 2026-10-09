import { apiJson } from '../src/lib/api'
import { splitMeetingEvidence, summarize, SummaryCheckpoint } from '../src/lib/meetingSummary'

jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }))

const answer = (content: string, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content } }] })
const request = (call: number) => JSON.parse(jest.mocked(apiJson).mock.calls[call][1]!.body as string)
const options = () => ({ guard: jest.fn(async () => {}), progress: jest.fn(), save: jest.fn(async (_value: SummaryCheckpoint) => {}) })

beforeEach(() => jest.mocked(apiJson).mockReset())

test('short transcript drafts directly and audits against the original evidence', async () => {
  jest.mocked(apiJson).mockResolvedValueOnce(answer('# 初稿') as never).mockResolvedValueOnce(answer('# 修订纪要') as never)
  const source = '[录音第 0 分钟起]\n讨论了 16 kHz 采样；没有形成决定。'
  const state = options()
  expect(await summarize(source, '语音方案', 'llm', state)).toBe('# 修订纪要')
  expect(apiJson).toHaveBeenCalledTimes(2)
  expect(request(0).messages[1].content).toContain(source)
  expect(request(1).messages[1].content).toContain(source)
  expect(request(0).messages[0].content).toContain('没有就完全省略')
  expect(request(0).messages[0].content).toContain('不设字数目标')
  expect(state.save).toHaveBeenCalledTimes(2)
  expect(state.save).toHaveBeenLastCalledWith(expect.objectContaining({ version: 8, parts: { draft: '# 初稿', audit: '# 修订纪要' } }))
})

test('version 7 prompt checkpoint is invalidated while version 8 resumes a saved draft', async () => {
  const source = '[录音第 0 分钟起]\n讨论测试。'
  jest.mocked(apiJson).mockResolvedValue(answer('# 新输出') as never)
  await summarize(source, '会议', 'llm', { ...options(), checkpoint: { version: 7, model: 'llm', title: '会议', source, parts: { draft: '旧稿', audit: '旧稿' } } as never })
  expect(apiJson).toHaveBeenCalledTimes(2)
  jest.mocked(apiJson).mockClear()
  const state = options()
  const result = await summarize(source, '会议', 'llm', { ...state, checkpoint: { version: 8, model: 'llm', title: '会议', source, parts: { draft: '# 已存初稿' } } })
  expect(result).toBe('# 新输出')
  expect(apiJson).toHaveBeenCalledTimes(1)
  expect(request(0).messages[1].content).toContain('# 已存初稿')
})

test('greeting-only transcript avoids fabricated substance without a mandatory layout', async () => {
  jest.mocked(apiJson).mockResolvedValue(answer('# 简短问候\n\n录音仅包含问候，未涉及实质议题。') as never)
  await summarize('[录音第 0 分钟起]\n喂，你好。你好。', '业务会议', 'llm', options())
  const draftPrompt: string = request(0).messages[0].content
  const auditPrompt: string = request(1).messages[0].content
  expect(draftPrompt).toContain('仅有问候或试音')
  expect(draftPrompt).toContain('简短说明无实质议题即可')
  expect(draftPrompt).toContain('不得从会议名称推断讨论内容')
  expect(draftPrompt).toContain('不预设会议类型、固定栏目')
  expect(auditPrompt).toContain('纠正错误')
  expect(auditPrompt).toContain('不另套固定栏目')
})

test('long evidence is split at 6000 characters with recording offsets retained', () => {
  const source = Array.from({ length: 8 }, (_, index) => `[录音第 ${index} 分钟起]\n${'讨论 16 kHz 条件和不同意见。'.repeat(100)}`).join('\n\n')
  const parts = splitMeetingEvidence(source, 6000)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.every(part => part.length <= 6000 && /^\[录音第 \d+ 分钟起\]/.test(part))).toBe(true)
  expect(parts.join('\n\n').replace(/\s/g, '')).toBe(source.replace(/\s/g, ''))
})

test('long facts run with at most two requests, persist independently, then draft and audit', async () => {
  let active = 0; let peak = 0
  jest.mocked(apiJson).mockImplementation(async (_path, init) => {
    const body = JSON.parse(init!.body as string)
    const system: string = body.messages[0].content
    if (system.includes('逐段提取')) {
      active++; peak = Math.max(active, peak)
      await new Promise<void>(resolve => setTimeout(resolve, 5))
      active--
      return answer('- [录音第 0 分钟起] 16 kHz 测试条件') as never
    }
    return answer(system.includes('核查初稿') ? '# 核查完成' : '# 初稿') as never
  })
  const source = Array.from({ length: 8 }, (_, index) => `[录音第 ${index} 分钟起]\n${'讨论 16 kHz 条件和不同意见。'.repeat(100)}`).join('\n\n')
  const state = options()
  expect(await summarize(source, '方案讨论', 'llm', state)).toBe('# 核查完成')
  expect(peak).toBe(2)
  const factCount = jest.mocked(apiJson).mock.calls.filter((_, index) => request(index).messages[0].content.includes('逐段提取')).length
  expect(factCount).toBeGreaterThan(1)
  expect(state.save).toHaveBeenCalledTimes(factCount + 2)
  expect(request(factCount + 1).messages[1].content).toContain('16 kHz 测试条件')
})

test('truncated output fails without caching or auditing and guard protects save', async () => {
  jest.mocked(apiJson).mockResolvedValueOnce(answer('# 半份纪要', 'length') as never)
  const state = options()
  await expect(summarize('少量转写', '会议', 'llm', state)).rejects.toThrow('截断')
  expect(state.save).not.toHaveBeenCalled()
  expect(apiJson).toHaveBeenCalledTimes(1)
  expect(state.guard).toHaveBeenCalled()
})

test('account change after a model reply prevents checkpoint writes and the audit', async () => {
  jest.mocked(apiJson).mockResolvedValue(answer('# 初稿') as never)
  let checks = 0
  const state = options()
  state.guard.mockImplementation(async () => { if (++checks >= 3) throw new Error('账号已切换') })
  await expect(summarize('短转写', '会议', 'llm', state)).rejects.toThrow('账号已切换')
  expect(apiJson).toHaveBeenCalledTimes(1)
  expect(state.save).not.toHaveBeenCalled()
})

test('oversized fact material merges with bounded concurrency and resumes saved merge parts', async () => {
  jest.mocked(apiJson).mockImplementation(async (_path, init) => {
    const body = JSON.parse(init!.body as string)
    const system: string = body.messages[0].content
    if (system.includes('逐段提取')) return answer('一条事实含偏移、数字和条件。'.repeat(400)) as never
    if (system.includes('合并重复事实')) return answer('- [录音第 0 分钟起] 保留 16 kHz 条件') as never
    return answer(system.includes('核查初稿') ? '# 最终纪要' : '# 初稿') as never
  })
  const source = '[录音第 0 分钟起]\n' + '讨论事实、条件及不同意见。'.repeat(1600)
  const state = options()
  expect(await summarize(source, '会议', 'llm', state)).toBe('# 最终纪要')
  const all = jest.mocked(apiJson).mock.calls.map((_, index) => request(index))
  expect(all.some(item => item.messages[0].content.includes('合并重复事实'))).toBe(true)
  expect(all.at(-1).messages[1].content).toContain('16 kHz 条件')
  const saved = state.save.mock.calls.at(-1)![0]
  expect(Object.keys(saved.parts).some(key => key.startsWith('merge:0:'))).toBe(true)
  jest.mocked(apiJson).mockClear()
  expect(await summarize(source, '会议', 'llm', { ...options(), checkpoint: saved })).toBe('# 最终纪要')
  expect(apiJson).not.toHaveBeenCalled()
})

test('meeting content chooses its structure without a word target or a mandatory short layout', async () => {
  jest.mocked(apiJson).mockResolvedValue(answer('# 方案交流\n\n## 两种方案的取舍\n\n先比较条件，再记录不同观点。') as never)
  const source = '[录音第 0 分钟起]\n讨论两种收音方案的适用条件，各方意见不同，目前继续比较。'
  await summarize(source, '方案交流', 'llm', options())
  const draft: string = request(0).messages[0].content
  const audit: string = request(1).messages[0].content
  expect(draft).toContain('由实际讨论内容决定结构')
  expect(draft).toContain('段落、要点或小标题')
  expect(draft).toContain('不设字数目标')
  expect(draft).not.toMatch(/极简|50–150|800–1200|只输出.*标题加一句话/)
  expect(audit).toContain('保留适合内容的组织方式')
  expect(audit).not.toContain('其余以删减和压缩为主')
  expect(apiJson).toHaveBeenCalledTimes(2)
})
