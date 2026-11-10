import { TransportError } from './errors'

/** Multipart remains native; the callback measures bytes sent, not recognition progress. */
export function uploadMeetingRequest(url: string, init: RequestInit, progress?: (percent: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const clean = () => {
      init.signal?.removeEventListener('abort', abort)
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null
      xhr.upload.onprogress = null
    }
    const fail = () => {
      if (settled) return
      settled = true
      clean()
      try { xhr.abort() } catch { /* Keep the original error. */ }
      reject(new TransportError('上传连接中断，原录音和任务记录已保留，请查看任务状态'))
    }
    const abort = () => fail()
    try {
      if (init.signal?.aborted) { fail(); return }
      init.signal?.addEventListener('abort', abort)
      xhr.open(init.method || 'POST', url, true)
      xhr.withCredentials = false
      new Headers(init.headers).forEach((value, key) => xhr.setRequestHeader(key, value))
      xhr.upload.onprogress = event => {
        if (!settled && event.lengthComputable && event.total > 0 && event.loaded >= 0 && event.loaded <= event.total) {
          try { progress?.(Math.floor(event.loaded * 100 / event.total)) } catch { fail() }
        }
      }
      xhr.onerror = xhr.onabort = xhr.ontimeout = fail
      xhr.onload = () => {
        if (!xhr.status) { fail(); return }
        const status = xhr.status, body = xhr.responseText, requestId = xhr.getResponseHeader('x-request-id')
        settled = true
        clean()
        resolve({ status, ok: status >= 200 && status < 300, headers: new Headers(requestId ? { 'x-request-id': requestId } : {}), text: async () => body } as Response)
      }
      xhr.send(init.body as any)
    } catch { fail() }
  })
}
