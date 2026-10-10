import { TransportError } from './errors'

export type ChatResult = { choices: [{ finish_reason: string; message: { content: string } }] }

/** Collect only the answer; reasoning and proxy keep-alives are not note content. */
export class OpenAiStream {
  private pending = ''
  private data: string[] = []
  private parts: string[] = []
  private characters = 0
  private done = false
  private reason: string | null = null

  constructor(private readonly onContent?: (characters: number) => void) {}

  push(text: string) {
    if (this.done) return
    this.pending += text
    if (this.pending.length > 1_000_000) throw new Error('模型流式事件过长')
    let newline: number
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, newline).replace(/\r$/, '')
      this.pending = this.pending.slice(newline + 1)
      if (!line) this.dispatch()
      else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''))
      if (this.done) { this.pending = ''; break }
    }
  }

  private dispatch() {
    if (!this.data.length) return
    const event = this.data.join('\n')
    this.data = []
    if (event === '[DONE]') { this.done = true; return }
    let value: any
    try { value = JSON.parse(event) } catch { throw new Error('模型返回无效的流式数据') }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new Error('模型流式处理失败，请稍后重试')
    if (!Array.isArray(value.choices)) throw new Error('模型返回无效的流式候选结果')
    for (const choice of value.choices) {
      if (!choice || typeof choice !== 'object') throw new Error('模型返回无效的流式候选结果')
      if ((choice.index ?? 0) !== 0) continue
      const delta = choice.delta ?? {}
      if (typeof delta !== 'object' || Array.isArray(delta)) throw new Error('模型返回无效的流式内容')
      if (delta.content != null && typeof delta.content !== 'string') throw new Error('模型返回无效的流式内容')
      if (typeof delta.content === 'string' && delta.content) {
        this.characters += delta.content.length
        if (this.characters > 2_000_000) throw new Error('模型输出过长')
        this.parts.push(delta.content)
        this.onContent?.(this.characters)
      }
      if (choice.finish_reason) this.reason = choice.finish_reason
    }
  }

  finish(): ChatResult {
    if (this.reason === 'length') throw new Error('模型输出被截断，请更换总结模型后重试；转写已保存')
    if (!this.done || this.reason !== 'stop') throw new TransportError('模型输出未完整结束，请重试；转写和已完成内容仍保留')
    const content = this.parts.join('')
    if (!content.trim()) throw new Error('模型没有返回纪要，请重试；转写已保存')
    return { choices: [{ finish_reason: 'stop', message: { content } }] }
  }
}
