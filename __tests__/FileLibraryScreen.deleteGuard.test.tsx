import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import * as RN from 'react-native'
import { FileLibraryScreen } from '../src/screens/FileLibraryScreen'
import { BottomActionSheet } from '../src/components/BottomActionSheet'
import { Field } from '../src/components/Field'
import { listLocalFiles, deleteLocalFile } from '../src/lib/localFiles'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn(async () => []) }))
jest.mock('../src/lib/localFiles', () => ({ listLocalFiles: jest.fn(), listLocalFileLinks: jest.fn(async () => []), deleteLocalFile: jest.fn(async () => {}), importLocalFile: jest.fn() }))
jest.mock('../src/lib/noteSourceFiles', () => ({ noteSourceFiles: jest.fn(async () => []) }))
const file = { id: '11111111-1111-4111-8111-111111111111', name: 'original.docx', uri: 'file:///documents/files/accounts/owner/11111111-1111-4111-8111-111111111111.docx', category: 'file' as const, purpose: 'note' as const, extension: 'docx', size: 20, createdAt: '2026-10-14' }
let view: Renderer.ReactTestRenderer, alert: jest.SpyInstance
const press = (label: string) => view.root.findAll(node => (node.props.accessibilityLabel === label || node.props.title === label) && typeof node.props.onPress === 'function')[0].props.onPress()
const controls = () => alert.mock.calls.at(-1)![2] as { text: string; onPress: () => void }[]
beforeEach(() => { jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('owner'); jest.mocked(listLocalFiles).mockResolvedValue([file]); alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {}) })
afterEach(async () => { if (view) await act(async () => view.unmount()); alert.mockRestore() })
async function open() {
  await act(async () => { view = Renderer.create(<FileLibraryScreen view={{ purpose: 'note', category: 'all', query: 'original' }} onRecording={jest.fn()} onOpenNote={jest.fn()} />, { createNodeMock: () => ({}) }) })
  await act(async () => press('打开文件 original.docx'))
  await act(async () => press('删除原始文件'))
}
test('cancel restores the same sheet/query and focuses file details rather than delete', async () => {
  const handle = jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(77), focus = jest.spyOn(RN.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {})
  try {
    await open(); expect(view.root.findByType(BottomActionSheet).props.visible).toBe(false)
    await act(async () => controls()[0].onPress())
    expect(view.root.findByType(BottomActionSheet).props.title).toBe(file.name)
    expect(view.root.findByType(Field).props.value).toBe('original')
    await act(async () => view.root.findAllByType(RN.Modal).find(node => node.props.onShow)!.props.onShow())
    expect(focus).toHaveBeenCalledWith(77); expect(deleteLocalFile).not.toHaveBeenCalled()
  } finally { handle.mockRestore(); focus.mockRestore() }
})
test.each(['identity', 'aba', 'route', 'unmount'])('%s invalidates both old cancel and destructive confirmation', async change => {
  await open(); const old = controls()
  if (change === 'identity' || change === 'aba') await act(async () => { transitionIdentity('B'); if (change === 'aba') transitionIdentity('owner') })
  if (change === 'route') await act(async () => view.update(<FileLibraryScreen sourceNote={{ id: 'different', title: 'new' } as never} onRecording={jest.fn()} onOpenNote={jest.fn()} />))
  if (change === 'unmount') await act(async () => view.unmount())
  await act(async () => { old[0].onPress(); old[1].onPress() })
  expect(deleteLocalFile).not.toHaveBeenCalled()
  if (change !== 'unmount') expect(view.root.findByType(BottomActionSheet).props.visible).toBe(false)
})
test('duplicate confirm invokes owner-bound delete once; dismissal does not restore sheet', async () => {
  let done!: () => void
  jest.mocked(deleteLocalFile).mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve }))
  await open(); const old = controls()
  await act(async () => { old[1].onPress(); old[1].onPress(); alert.mock.calls.at(-1)![3].onDismiss() })
  expect(deleteLocalFile).toHaveBeenCalledTimes(1)
  expect(deleteLocalFile).toHaveBeenCalledWith(file, 'owner', expect.any(Number), expect.any(Function))
  expect(view.root.findByType(BottomActionSheet).props.visible).toBe(false)
  await act(async () => done())
})

test('cancel consumes the old destructive callback, and normal failure restores a reviewable original', async () => {
  await open(); const old = controls()
  await act(async () => old[0].onPress())
  await act(async () => old[1].onPress())
  expect(deleteLocalFile).not.toHaveBeenCalled()
  jest.mocked(deleteLocalFile).mockRejectedValueOnce(new Error('删除未完成'))
  await act(async () => press('删除原始文件'))
  await act(async () => controls()[1].onPress())
  expect(view.root.findByType(BottomActionSheet).props.visible).toBe(true)
  expect(view.root.findByType(BottomActionSheet).props.title).toBe(file.name)
})
