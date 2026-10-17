import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FeishuDestinationPicker } from '../src/components/FeishuDestinationPicker'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { feishuApi } from '../src/lib/feishu'

jest.mock('../src/lib/feishu', () => ({ feishuApi: jest.fn() }))
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'A') }))
beforeEach(() => { jest.mocked(feishuApi).mockReset(); jest.mocked(readAccountId).mockResolvedValue('A'); transitionIdentity('A') })
it('keeps selection through a failed folder read, retries that folder and returns to its parent', async () => {
  const api = jest.mocked(feishuApi)
  const root = { items: [{ kind: 'folder', folder_token: 'parent', name: '父目录' }], has_more: false, page_token: '' }
  api.mockResolvedValueOnce(root).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({ items: [], has_more: false, page_token: '' }).mockResolvedValueOnce(root)
  const change = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDestinationPicker value={{ kind: 'folder', folder_token: 'chosen' }} onChange={change} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => { await button('浏览可见文件夹').props.onPress() })
  await act(async () => { await button('进入子目录').props.onPress() })
  expect(change).not.toHaveBeenCalled()
  expect(api.mock.calls[1][0]).toContain('folder_token=parent')
  await act(async () => { await button('重新读取此位置').props.onPress() })
  expect(api.mock.calls[2][0]).toContain('folder_token=parent')
  await act(async () => { await button('返回上一级位置').props.onPress() })
  expect(api.mock.calls[3][0]).toContain('folder_token=')
  expect(view.root.findByType(FeishuDestinationPicker).props.value.folder_token).toBe('chosen')
  expect(change).not.toHaveBeenCalled()
  await act(async () => { view.unmount() })
})

it('retries the failed page with its cursor and does not label a non-final empty page as an empty directory', async () => {
  const api = jest.mocked(feishuApi)
  api.mockResolvedValueOnce({ items: [], has_more: true, page_token: 'next' })
    .mockRejectedValueOnce(new Error('下一页读取失败'))
    .mockResolvedValueOnce({ items: [{ kind: 'folder', folder_token: 'found', name: '实际目录' }], has_more: false, page_token: '' })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDestinationPicker value={{ kind: 'folder' }} onChange={jest.fn()} />) })
  const button = (title: string) => view.root.findAllByType(PrimaryButton).find(item => item.props.title === title)!
  await act(async () => { await button('浏览可见文件夹').props.onPress() })
  expect(JSON.stringify(view.toJSON())).toContain('当前页没有可见位置，请继续读取下一页。')
  expect(JSON.stringify(view.toJSON())).not.toContain('此处没有可见位置，可返回上级或填写已知标识。')
  await act(async () => { await button('继续读取下一页').props.onPress() })
  await act(async () => { await button('重新读取此位置').props.onPress() })
  expect(api.mock.calls[1][0]).toContain('page_token=next')
  expect(api.mock.calls[2][0]).toContain('page_token=next')
  expect(JSON.stringify(view.toJSON())).toContain('实际目录')
  await act(async () => { view.unmount() })
})

const valid = { name: '实际位置', path: ['实际位置'], path_complete: true, can_attempt_create: true, can_create: true }
it('check binds owner, revokes old approval before await and keeps it revoked on failure', async () => {
  let fail!: (reason: Error) => void
  jest.mocked(feishuApi).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  const checked = jest.fn(), change = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDestinationPicker value={{ kind: 'personal' }} onChange={change} onChecked={checked} />) })
  checked.mockClear()
  const button = () => view.root.findAllByType(PrimaryButton).find(item => item.props.title === '核验位置与权限')!
  await act(async () => button().props.onPress())
  expect(checked).toHaveBeenCalledWith(false)
  expect(feishuApi).toHaveBeenCalledWith('/destinations/check', { method: 'POST', body: JSON.stringify({ kind: 'personal' }) }, 'A')
  expect(button().props.disabled).toBe(true)
  await act(async () => button().props.onPress())
  expect(feishuApi).toHaveBeenCalledTimes(1)
  await act(async () => fail(new Error('位置核验失败')))
  expect(checked.mock.calls.every(([allowed]) => allowed === false)).toBe(true)
  expect(JSON.stringify(view.toJSON())).toContain('位置核验失败')
  await act(async () => view.unmount())
})
it.each(['value', 'identity', 'unmount'] as const)('delayed check cannot acknowledge after %s changes', async kind => {
  let finish!: (value: typeof valid) => void
  jest.mocked(feishuApi).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const checked = jest.fn(), change = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDestinationPicker value={{ kind: 'folder', folder_token: 'old' }} onChange={change} onChecked={checked} />) })
  await act(async () => view.root.findAllByType(PrimaryButton).find(item => item.props.title === '核验位置与权限')!.props.onPress())
  if (kind === 'value') await act(async () => view.update(<FeishuDestinationPicker value={{ kind: 'folder', folder_token: 'new' }} onChange={change} onChecked={checked} />))
  if (kind === 'identity') await act(async () => { transitionIdentity('B'); transitionIdentity('A') })
  if (kind === 'unmount') await act(async () => view.unmount())
  checked.mockClear()
  await act(async () => finish(valid))
  expect(checked).not.toHaveBeenCalled()
  if (kind !== 'unmount') { expect(JSON.stringify(view.toJSON())).not.toContain('实际位置'); await act(async () => view.unmount()) }
})
it('identity change clears cached directories and rejects old captured button callbacks', async () => {
  jest.mocked(feishuApi).mockResolvedValue({ items: [{ kind: 'folder', folder_token: 'old', name: '旧账号目录' }], has_more: false, page_token: '' })
  const checked = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuDestinationPicker value={{ kind: 'folder' }} onChange={jest.fn()} onChecked={checked} />) })
  const oldCheck = view.root.findAllByType(PrimaryButton).find(item => item.props.title === '核验位置与权限')!.props.onPress
  await act(async () => view.root.findAllByType(PrimaryButton).find(item => item.props.title === '浏览可见文件夹')!.props.onPress())
  expect(feishuApi).toHaveBeenCalledWith(expect.stringContaining('/destinations?'), {}, 'A')
  await act(async () => { transitionIdentity('B'); jest.mocked(readAccountId).mockResolvedValue('B') })
  expect(JSON.stringify(view.toJSON())).not.toContain('旧账号目录')
  jest.mocked(feishuApi).mockClear()
  await act(async () => oldCheck())
  expect(feishuApi).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})
