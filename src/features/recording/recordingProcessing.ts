const held = new Set<string>()

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
