import { NativeEventEmitter, NativeModules } from 'react-native'
import FS from 'react-native-fs'
import { analyzeSpeakers } from '../src/lib/meetingSpeakers'
import { refineSpeakerGroups } from '../src/lib/speakerClustering'
import type { SpeakerProgress } from '../src/lib/speakerProgress'
jest.mock('react-native-fs', () => ({ stat: jest.fn(async () => ({ size: 1, mtime: 1 })), unlink: jest.fn(async () => {}) }))
jest.mock('../src/lib/speakerClustering', () => ({ refineSpeakerGroups: jest.fn() }))
it('binds feature percentages to distinct batches, drops old-batch events, and waits for final persistence', async () => {
  let event!: (value: Object) => void
  const remove = jest.fn()
  const spy = jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockImplementation((_name, callback) => { event = callback; return { remove } })
  let previousJob = ''
  const checkpoints: SpeakerProgress[] = []
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache.wav') }
  NativeModules.MeetingSpeakers = { addListener: jest.fn(), removeListeners: jest.fn(), analyze: jest.fn(), embeddings: jest.fn(async (_wav, _windows, jobId) => {
    if (previousJob) event({ jobId: previousJob, phase: 'refining', progress: 99 })
    event({ jobId, phase: 'refining', progress: previousJob ? 74 : 100 })
    previousJob = jobId
    return [[1, 0]]
  }) }
  jest.mocked(refineSpeakerGroups).mockImplementation(async (turns, extract) => {
    await extract([{ start: 0, end: 3 }]); await extract([{ start: 4, end: 7 }])
    return { turns, clustering: { method: 'test', reliable: true, speakerCount: 1, rejectedGroups: 0, silhouette: 1, representativeTurns: 2, analyzedTurns: 2 } }
  })
  let finish!: () => void
  const finalSave = new Promise<void>(resolve => { finish = resolve })
  let saving!: () => void
  const reachedSave = new Promise<void>(resolve => { saving = resolve })
  const pending = analyzeSpeakers('file:///original.wav', {
    checkpoint: { version: 1, provider: 'sherpa-onnx-1.12.35', source: { size: 1, modifiedMs: 1 }, duration: 10, turns: [{ start: 0, end: 3, speakerId: 'speaker_1' }] },
    guard: async () => {}, progress: (_text, detail) => { if (detail) checkpoints.push(detail) },
    save: async value => { if (value.clusteringVersion === 2) { saving(); await finalSave } },
  })
  await reachedSave
  const measured = checkpoints.filter(value => value.percent !== undefined)
  expect(measured.map(value => [value.unit?.index, value.percent])).toEqual([[1, 100], [2, 74]])
  expect(checkpoints.at(-1)?.phase).toBe('saving')
  expect(checkpoints.at(-1)?.percent).toBeUndefined()
  expect(checkpoints.some(value => value.phase === 'saved')).toBe(false)
  finish(); await pending
  expect(remove).toHaveBeenCalled(); expect(FS.unlink).toHaveBeenCalledWith('/cache.wav')
  spy.mockRestore()
})
