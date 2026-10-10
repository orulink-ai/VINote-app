import { apiTextStream } from './api'
import { OpenAiStream } from './openAiStream'
import { ApiError } from './errors'

export type ChatMessage = { role: 'system' | 'user'; content: string }
export async function chatCompletion(model: string, messages: ChatMessage[], owner?: string, onContent?: (characters: number) => void) {
  // A retry calls this function again and gets a fresh collector. Partial output
  // from a failed request must never contaminate a subsequent answer.
  const stream = new OpenAiStream(onContent)
  try {
    await apiTextStream('/openai/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model, stream: true, messages }),
    }, text => stream.push(text), owner)
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && /Access to model denied/i.test(error.message)) {
      throw new ApiError('当前纪要模型暂不可用，请稍后重试或更换模型。转写和已完成进度已保留。', 403, error.details)
    }
    throw error
  }
  return stream.finish()
}
