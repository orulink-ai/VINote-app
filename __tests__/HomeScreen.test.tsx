import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { HomeScreen } from '../src/screens/HomeScreen'
import { listRecordings } from '../src/features/recording/recordingLibrary'
import { listNotes } from '../src/lib/notes'

jest.mock('../src/features/recording/recordingLibrary', () => ({ listRecordings: jest.fn() }))
jest.mock('../src/lib/notes', () => ({ listNotes: jest.fn() }))

test('home offers direct capture and import, and opens recent content', async () => {
  jest.mocked(listRecordings).mockResolvedValue([{ id: 'r1', title: '产品周会', uri: 'file:///r1.m4a', createdAt: '2026-10-09T08:00:00Z', duration: 90 }])
  jest.mocked(listNotes).mockResolvedValue([{ id: 'n1', title: '周会纪要', content: '', status: 'done', created_at: '2026-10-09T08:30:00Z', updated_at: '2026-10-09T08:30:00Z' }])
  const onRecord = jest.fn()
  const onImport = jest.fn()
  const onRecordings = jest.fn()
  const onOpenNote = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<HomeScreen onRecord={onRecord} onImport={onImport} onRecordings={onRecordings} onNotes={jest.fn()} onOpenNote={onOpenNote} onSignOut={jest.fn()} />) })
  const press = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]
  await act(async () => { press('开始录音').props.onPress() })
  await act(async () => { press('导入音频').props.onPress() })
  await act(async () => { press('打开录音：产品周会').props.onPress() })
  await act(async () => { press('打开纪要：周会纪要').props.onPress() })
  expect(onRecord).toHaveBeenCalledTimes(1)
  expect(onImport).toHaveBeenCalledTimes(1)
  expect(onRecordings).toHaveBeenCalledTimes(1)
  expect(onOpenNote).toHaveBeenCalledWith('n1')
  await act(async () => view.unmount())
})
