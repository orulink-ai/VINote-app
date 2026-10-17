import type { AsrProgress } from '../../lib/asrProgress'
import type { SpeakerProgress } from '../../lib/speakerProgress'
const held = new Set<string>()
let generationActive = false
export type GenerationProgress = { owner: string; recordId: string; text: string; asrProgress?: AsrProgress; transcriptionPercent?: number; speakerPercent?: number; speakerStage?: SpeakerProgress }
let generationProgress: GenerationProgress | null = null
const progressListeners = new Set<() => void>()
export const getGenerationProgress = () => generationProgress
export function subscribeGenerationProgress(listener: () => void) {
  progressListeners.add(listener)
  return () => { progressListeners.delete(listener) }
}
export function reportGenerationProgress(owner: string, recordId: string, text: string, measured?: Pick<GenerationProgress, 'asrProgress' | 'transcriptionPercent' | 'speakerPercent' | 'speakerStage'>) {
  generationProgress = { owner, recordId, text, ...measured }
  progressListeners.forEach(listener => listener())
}

/** One complete generation prevents overlapping native memory and foreground services. */
export function acquireGenerationSlot(): () => void {
  if (generationActive) throw new Error('已有录音正在整理，请完成后再生成下一份；原音频已保留')
  generationActive = true
  let released = false
  return () => {
    if (released) return
    released = true
    generationActive = false
    generationProgress = null
    progressListeners.forEach(listener => listener())
  }
}

function key(owner: string, recordId: string) {
  if (!owner || !/^[a-zA-Z0-9-]+$/.test(recordId)) throw new Error('录音标识无效')
  return `${owner.length}:${owner}:${recordId}`
}

/** Protect one recording across generation, rename, and deletion in this JS process. */
export function acquireRecordingLock(owner: string, recordId: string): () => void {
  const id = key(owner, recordId)
  if (held.has(id)) throw new Error('这条录音正在处理中，请稍后重试')
  held.add(id)
  let released = false
  return () => {
    if (released) return
    released = true
    held.delete(id)
  }
}
