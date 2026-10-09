import { ApiError, TransportError } from './errors'

export type ProcessingTiming = { stage: string; durationMs: number; index?: number; cacheHit?: boolean; bytes?: number }
export type ProcessingOptions<T> = {
  owner?: string
  checkpoint?: T
  progress: (text: string) => void
  save: (checkpoint: T) => Promise<void>
  guard: () => Promise<void>
  timing?: (event: ProcessingTiming) => void
}

export async function retry<T>(operation: () => Promise<T>, guard: () => Promise<void>, progress: (text: string) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await guard()
    try { return await operation() } catch (error) {
      const transient = error instanceof TransportError || (error instanceof ApiError && [429, 502, 503, 504].includes(error.status))
      if (attempt >= 2 || !transient) throw error
      progress(`服务暂时繁忙，正在重试当前请求（${attempt + 1}/2）；已完成内容已保留`)
      await new Promise<void>(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
    }
  }
}

/** Stop scheduling on failure, but finish in-flight work before releasing its resources. */
export async function mapConcurrent<T, R>(values: readonly T[], limit: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('无效的并发数量')
  const results: R[] = new Array(values.length)
  let next = 0
  let failed = false
  let failure: unknown
  const worker = async () => {
    while (!failed && next < values.length) {
      const index = next++
      try { results[index] = await operation(values[index], index) }
      catch (error) { if (!failed) { failed = true; failure = error } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  if (failed) throw failure
  return results
}

/** A checkpoint write must complete before the next write starts. */
export function createSerialQueue() {
  let pending = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const current = pending.then(operation)
    pending = current.then(() => {}, () => {})
    return current
  }
}

export async function measure<T>(stage: string, operation: () => Promise<T>, timing?: (event: ProcessingTiming) => void, index?: number): Promise<T> {
  const start = Date.now()
  try { return await operation() }
  finally { timing?.({ stage, index, durationMs: Math.max(0, Date.now() - start) }) }
}
