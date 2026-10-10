import { TransportError } from './errors'

export type TextStreamResponse = { status: number; text: string; contentType: string; requestId?: string }

/** RN's XMLHttpRequest supports incremental text on Android and iOS. */
export function requestTextStream(url: string, init: RequestInit, receive: (text: string) => void): Promise<TextStreamResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    let received = 0
    let deadline: ReturnType<typeof setTimeout> | undefined
    const clean = () => {
      if (deadline !== undefined) clearTimeout(deadline)
      deadline = undefined
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = xhr.onprogress = null
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clean()
      try { xhr.abort() } catch { /* Preserve the request's original failure. */ }
      reject(error)
    }
    const consume = () => {
      if (settled || xhr.status < 200 || xhr.status >= 300) return
      try {
        const contentType = xhr.getResponseHeader('Content-Type') || ''
        if (!contentType.toLowerCase().startsWith('text/event-stream')) return
        const text = xhr.responseText
        if (text.length > 8_000_000) throw new Error('模型流式响应过长')
        if (text.length > received) {
          const delta = text.slice(received)
          received = text.length
          receive(delta)
        }
      } catch (error) { fail(error) }
    }
    try {
      xhr.open(init.method || 'POST', url, true)
      xhr.responseType = 'text'
      xhr.withCredentials = false
      xhr.timeout = 900_000
      new Headers(init.headers).forEach((value, key) => xhr.setRequestHeader(key, value))
      xhr.onprogress = consume
      xhr.onerror = () => fail(new TransportError('会议服务连接中断，请重试；已完成内容仍保留'))
      const timeout = () => fail(new TransportError('会议总结超过时间上限，请重试；转写已保存'))
      xhr.ontimeout = timeout
      xhr.onabort = () => fail(new TransportError('会议总结请求已中断；已完成内容仍保留'))
      xhr.onload = () => {
        if (xhr.status === 0) {
          fail(new TransportError('会议服务连接中断，请重试；已完成内容仍保留'))
          return
        }
        consume()
        if (settled) return
        try {
          const response = { status: xhr.status, text: xhr.responseText, contentType: xhr.getResponseHeader('Content-Type') || '',
            requestId: xhr.getResponseHeader('x-request-id') || undefined }
          settled = true
          clean()
          resolve(response)
        } catch (error) { fail(error) }
      }
      // iOS's native timeout measures inactivity. This deadline also bounds
      // continuously active streams, starting when the request is sent.
      deadline = setTimeout(timeout, 900_000)
      xhr.send(init.body as string)
    } catch (error) { fail(error) }
  })
}
