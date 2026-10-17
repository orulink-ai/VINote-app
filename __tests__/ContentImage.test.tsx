import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Image } from 'react-native'
import FS from 'react-native-fs'
import { ContentImage } from '../src/components/ContentImage'
import { readAccountId, sessionRevision } from '../src/lib/storage'
import { integrationJson } from '../src/lib/integration'
import { accessToken } from '../src/lib/supabase'
import { beginVerification, finishVerification, pauseRemote } from '../src/lib/sessionGate'

jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner-a'), sessionRevision: jest.fn(() => 1) }))
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'http://127.0.0.1:8900', integrationBaseUrl: 'https://owned.example', integrationJson: jest.fn(), operationId: jest.fn(() => 'test-image-id') }))
jest.mock('../src/lib/supabase', () => ({ accessToken: jest.fn(async () => 'synthetic-attachment-token') }))
const views: Renderer.ReactTestRenderer[] = []
const originalURL = globalThis.URL
// The RN Jest environment does not install the device's global URL class.
// Exercise the actual native parser instead of substituting Node's parser.
beforeAll(() => { globalThis.URL = require('react-native/Libraries/Blob/URL').URL })
afterAll(() => { globalThis.URL = originalURL })
async function mount(element: React.ReactElement) {
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(element) })
  views.push(view); return view
}
const buttons = (view: Renderer.ReactTestRenderer) => view.root.findAll(node => node.props?.accessibilityRole === 'button' && typeof node.props.onPress === 'function')
  .filter((node, index, all) => all.findIndex(other => other.props.accessibilityLabel === node.props.accessibilityLabel) === index)
const images = (view: Renderer.ReactTestRenderer) => view.root.findAllByType(Image)
const download = jest.fn(), stop = jest.fn()
beforeEach(() => { jest.clearAllMocks(); finishVerification(beginVerification('owner-a'), 'verified'); jest.mocked(readAccountId).mockReset().mockResolvedValue('owner-a'); jest.mocked(sessionRevision).mockReturnValue(1); Object.assign(FS, { downloadFile: download, stopDownload: stop }) })
afterEach(() => { act(() => views.splice(0).forEach(view => view.unmount())) })

test('unverified private attachments and task screenshots make no authorized read', async () => {
  pauseRemote()
  const path = '/api/task/11111111-1111-4111-8111-111111111111/artifacts/screenshots/frame.png'
  const view = await mount(<><ContentImage source={'attachment://' + 'a'.repeat(64)} /><ContentImage source={path} /></>)
  expect(images(view)).toHaveLength(0); expect(download).not.toHaveBeenCalled()
  expect(integrationJson).not.toHaveBeenCalled(); expect(accessToken).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).toContain('账号待核验')
})

test('background verification pause hides an already resolved private attachment', async () => {
  jest.mocked(integrationJson).mockResolvedValueOnce({ url: 'https://private.example/signed.png', authenticated: false })
  const view = await mount(<ContentImage source={'attachment://' + 'a'.repeat(64)} />)
  expect(images(view)).toHaveLength(1)
  await act(async () => pauseRemote())
  expect(images(view)).toHaveLength(0)
  expect(integrationJson).toHaveBeenCalledTimes(1)
})

test('saved Markdown images wait for independent per-image clicks without any bearer or service request', async () => {
  const parsed = new URL('https://images.example/a.png')
  expect(parsed.hostname).toBe('images.example')
  expect(parsed.username).toBe('')
  expect(parsed.password).toBe('')
  const view = await mount(<><ContentImage source="https://images.example/a.png?secret=not-in-label" alt="第一张" /><ContentImage source="https://other.example/b.png" alt="第二张" /></>)
  expect(images(view)).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).not.toContain('secret=')
  expect(JSON.stringify(view.toJSON())).toContain('加载图片')
  expect(buttons(view)[0].props.accessibilityLabel).toBe('加载图片：第一张（images.example）')
  expect(buttons(view)[0].props.style.minHeight).toBe(48)
  await act(async () => { buttons(view)[0].props.onPress() })
  expect(images(view)).toHaveLength(1)
  expect(images(view)[0].props.source).toEqual({ uri: 'https://images.example/a.png?secret=not-in-label' })
  expect(buttons(view)[1].props.disabled).toBe(false)
  expect(integrationJson).not.toHaveBeenCalled()
  expect(accessToken).not.toHaveBeenCalled()
})

test('failed external image retains description and offers an explicit retry with no automatic reload', async () => {
  const view = await mount(<ContentImage source="https://images.example/a.png" alt="图表" />)
  await act(async () => { buttons(view)[0].props.onPress() })
  await act(async () => { images(view)[0].props.onError() })
  expect(images(view)).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('图表')
  expect(buttons(view)[0].props.accessibilityLabel).toBe('重试加载图片：图表（images.example）')
  await act(async () => { buttons(view)[0].props.onPress() })
  await act(async () => { images(view)[0].props.onLoad() })
  expect(buttons(view)).toHaveLength(0)
})

test.each(['javascript:alert(1)', 'data:image/png;base64,AA', 'file:///private.png', 'blob:local', '/api/auth/session', '//images.example/x.png', 'https://trusted.example@evil.example/x', 'https://%65vil.example/x', 'https://images.example\\@evil.example/x', 'attachment://invalid'])('unsupported or ambiguous source cannot execute: %s', async source => {
  const view = await mount(<ContentImage source={source} />)
  expect(images(view)).toHaveLength(0)
  expect(buttons(view)).toHaveLength(0)
  expect(JSON.stringify(view.toJSON())).toContain('图片未提供说明')
})

test('changing source or reopening a preview session clears the image authorization', async () => {
  const view = await mount(<ContentImage source="https://images.example/a.png" imageSessionKey="preview-1" />)
  await act(async () => { buttons(view)[0].props.onPress() })
  await act(async () => { view.update(<ContentImage source="https://images.example/b.png" imageSessionKey="preview-1" />) })
  expect(images(view)).toHaveLength(0)
  await act(async () => { buttons(view)[0].props.onPress() })
  await act(async () => { view.update(<ContentImage source="https://images.example/b.png" imageSessionKey="preview-2" />) })
  expect(images(view)).toHaveLength(0)
})

test('switching accounts while the click awaits its owner cannot begin an image request', async () => {
  const view = await mount(<ContentImage source="https://images.example/a.png" />)
  let resolve!: (owner: string) => void
  jest.mocked(readAccountId).mockReturnValueOnce(new Promise(done => { resolve = done }))
  act(() => { buttons(view)[0].props.onPress() })
  jest.mocked(sessionRevision).mockReturnValue(2)
  await act(async () => { resolve('owner-a') })
  expect(images(view)).toHaveLength(0)
  jest.mocked(readAccountId).mockResolvedValue('owner-b')
  await act(async () => { view.update(<ContentImage source="https://images.example/a.png" />) })
  await act(async () => { buttons(view)[0].props.onPress() })
  expect(images(view)).toHaveLength(1)
})

test.each([false, true])('exact owner attachment bypasses external confirmation, authenticated=%s', async authenticated => {
  jest.mocked(integrationJson).mockResolvedValue({ url: authenticated ? '/api/workspace/attachments/image/content' : 'https://storage.example/signed.png?token=opaque', authenticated })
  const id = 'a'.repeat(64), view = await mount(<ContentImage source={`attachment://${id}`} alt="附件" />)
  expect(integrationJson).toHaveBeenCalledWith(`/api/workspace/attachments/${id}/access`, {}, 'owner-a')
  expect(buttons(view)).toHaveLength(0)
  expect(images(view)[0].props.source).toEqual(authenticated ? { uri: 'https://owned.example/api/workspace/attachments/image/content', headers: { Authorization: 'Bearer synthetic-attachment-token' } } : { uri: 'https://storage.example/signed.png?token=opaque', headers: undefined })
  expect(accessToken).toHaveBeenCalledTimes(authenticated ? 1 : 0)
})

const screenshot = '/api/task/12345678-1234-1234-1234-123456789abc/artifacts/screenshots/frame_1.5.jpg'
function successfulDownload(size = 123, type = 'image/jpeg') {
  download.mockImplementation(options => {
    options.begin({ jobId: 42, statusCode: 200, contentLength: size, headers: { 'Content-Type': type } })
    return { jobId: 42, promise: Promise.resolve({ statusCode: 200, bytesWritten: size }) }
  })
}

test.each([screenshot, `http://127.0.0.1:8900${screenshot}`])('fixed-owner task screenshot is fetched into a bounded temporary file instead of the external-image channel: %s', async source => {
  successfulDownload()
  const view = await mount(<ContentImage source={source} alt="原截图" />)
  expect(download).toHaveBeenCalledTimes(1)
  expect(download.mock.calls[0][0]).toEqual(expect.objectContaining({ fromUrl: `http://127.0.0.1:8900${screenshot}`, toFile: '/cache/vinote-content/owner-a/test-image-id.image', headers: { Authorization: 'Bearer synthetic-attachment-token' }, connectionTimeout: 10000, readTimeout: 20000 }))
  expect(accessToken).toHaveBeenCalledWith(false, 'owner-a')
  expect(images(view)[0].props.source).toEqual({ uri: 'file:///cache/vinote-content/owner-a/test-image-id.image' })
  expect(buttons(view)).toHaveLength(0)
  act(() => view.unmount())
  expect(stop).toHaveBeenCalledWith(42)
  expect(FS.unlink).toHaveBeenCalledWith('/cache/vinote-content/owner-a/test-image-id.image')
})

test('foreign origin with the same artifact path still requires confirmation and never receives the owner token', async () => {
  const view = await mount(<ContentImage source={`https://foreign.example${screenshot}`} />)
  expect(download).not.toHaveBeenCalled()
  expect(accessToken).not.toHaveBeenCalled()
  expect(images(view)).toHaveLength(0)
  await act(async () => { buttons(view)[0].props.onPress() })
  expect(images(view)[0].props.source).toEqual({ uri: `https://foreign.example${screenshot}` })
  expect(download).not.toHaveBeenCalled()
  expect(accessToken).not.toHaveBeenCalled()
})

test.each(['/api/auth/session', screenshot.replace('/screenshots/', '/private/'), screenshot.replace('frame_1.5.jpg', '../frame.jpg'), screenshot.replace('frame_1.5.jpg', 'frame.svg'), screenshot + '?redirect=https://foreign.example'])('untrusted relative resource is not promoted to the device channel: %s', async source => {
  const view = await mount(<ContentImage source={source} />)
  expect(download).not.toHaveBeenCalled()
  expect(accessToken).not.toHaveBeenCalled()
  expect(images(view)).toHaveLength(0)
  expect(buttons(view)).toHaveLength(0)
})

test.each([[6 * 1024 * 1024, 'image/jpeg'], [123, 'text/html']])('oversize or non-image device response is discarded and offers explicit retry: %s bytes %s', async (size, type) => {
  successfulDownload(size, type)
  const view = await mount(<ContentImage source={screenshot} />)
  expect(images(view)).toHaveLength(0)
  expect(stop).toHaveBeenCalledWith(42)
  expect(FS.unlink).toHaveBeenCalledWith('/cache/vinote-content/owner-a/test-image-id.image')
  expect(buttons(view)[0].props.accessibilityLabel).toBe('重试读取截图：内容截图')
  expect(download).toHaveBeenCalledTimes(1)
  successfulDownload()
  await act(async () => { buttons(view)[0].props.onPress() })
  expect(download).toHaveBeenCalledTimes(2)
  expect(images(view)).toHaveLength(1)
})

test('account switch while resolving a device-image token prevents the download', async () => {
  let resolve!: (token: string) => void
  jest.mocked(accessToken).mockReturnValueOnce(new Promise(done => { resolve = done }))
  const view = await mount(<ContentImage source={screenshot} />)
  jest.mocked(readAccountId).mockResolvedValue('owner-b')
  jest.mocked(sessionRevision).mockReturnValue(2)
  await act(async () => { resolve('synthetic-attachment-token') })
  expect(download).not.toHaveBeenCalled()
  expect(images(view)).toHaveLength(0)
})

test('late download after owner switch is discarded without rendering the old-owner cache', async () => {
  let resolve!: (result: { statusCode: number; bytesWritten: number }) => void
  download.mockImplementation(options => {
    options.begin({ jobId: 42, statusCode: 200, contentLength: 123, headers: { 'Content-Type': 'image/jpeg' } })
    return { jobId: 42, promise: new Promise(done => { resolve = done }) }
  })
  const view = await mount(<ContentImage source={screenshot} />)
  expect(download).toHaveBeenCalledTimes(1)
  jest.mocked(readAccountId).mockResolvedValue('owner-b')
  jest.mocked(sessionRevision).mockReturnValue(2)
  await act(async () => { resolve({ statusCode: 200, bytesWritten: 123 }) })
  expect(images(view)).toHaveLength(0)
  expect(FS.unlink).toHaveBeenCalledWith('/cache/vinote-content/owner-a/test-image-id.image')
})
