import { uploadMeetingRequest } from '../src/lib/meetingUploadTransport'

let instance: any
const originalXHR = globalThis.XMLHttpRequest
class FakeXHR {
  upload: any = {}
  status = 202
  responseText = '{"status":"accepted"}'
  onload: any; onerror: any; onabort: any; ontimeout: any
  open = jest.fn(); setRequestHeader = jest.fn(); send = jest.fn(); abort = jest.fn()
  getResponseHeader = jest.fn(() => null)
  constructor() { instance = this }
}
beforeEach(() => { (globalThis as any).XMLHttpRequest = FakeXHR })
afterEach(() => { (globalThis as any).XMLHttpRequest = originalXHR })

test('reports measured upload bytes once and returns the actual server response', async () => {
  const progress = jest.fn()
  const pending = uploadMeetingRequest('https://example.test/jobs', { method: 'POST', body: new FormData() }, progress)
  instance.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 })
  instance.upload.onprogress({ lengthComputable: false, loaded: 30, total: 100 })
  expect(progress).toHaveBeenCalledTimes(1)
  expect(progress).toHaveBeenCalledWith(25)
  expect(instance.send).toHaveBeenCalledTimes(1)
  instance.onload()
  expect((await pending).status).toBe(202)
})

test('aborts an in-flight upload without sending a second request', async () => {
  const controller = new AbortController()
  const pending = uploadMeetingRequest('https://example.test/jobs', { method: 'POST', body: new FormData(), signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(instance.abort).toHaveBeenCalledTimes(1)
  expect(instance.send).toHaveBeenCalledTimes(1)
})
