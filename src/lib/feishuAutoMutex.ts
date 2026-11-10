// Serializes saved consent changes with the one-shot dispatch decision.
let pending: Promise<void> = Promise.resolve()
export function withFeishuAutoLock<T>(operation: () => Promise<T>): Promise<T> {
  const work = pending.catch(() => {}).then(operation)
  pending = work.then(() => undefined, () => undefined)
  return work
}
