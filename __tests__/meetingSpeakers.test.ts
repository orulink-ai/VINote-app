import { analyzeSpeakers, meetingEvidence, partitionSpeakerTurns } from '../src/lib/meetingSpeakers'
import { NativeEventEmitter, NativeModules, Platform } from 'react-native'
import FS from 'react-native-fs'
import * as clustering from '../src/lib/speakerClustering'
import type { SpeakerCheckpoint } from '../src/lib/meetingSpeakers'
jest.mock('react-native-fs', () => ({ stat: jest.fn(), unlink: jest.fn(async () => {}) }))

test('speaker intervals preserve mixed speech rather than assigning it to one person', () => {
  expect(partitionSpeakerTurns([{ start: 0, end: 4, speaker: 7 }, { start: 2, end: 6, speaker: 3 }], 6)).toEqual([
    { start: 0, end: 2, speakerId: 'speaker_1' }, { start: 2, end: 4, speakerId: 'speaker_overlap' },
    { start: 4, end: 6, speakerId: 'speaker_2' },
  ])
})

test('minute text and independent evidence stay within the same chunk with uncertain sentence attribution', () => {
  const evidence = meetingEvidence('[录音第 0 分钟起]\n第一段\n\n[录音第 1 分钟起]\n第二段', {
    version: 1, provider: 'sherpa-onnx-1.12.35', source: { size: 1, modifiedMs: 1 }, duration: 120,
    turns: [{ start: 2, end: 10, speakerId: 'speaker_1' }, { start: 70, end: 80, speakerId: 'speaker_2' }],
  })
  expect(evidence.indexOf('说话人 1')).toBeLessThan(evidence.indexOf('[录音第 1 分钟起]'))
  expect(evidence.indexOf('说话人 2')).toBeGreaterThan(evidence.indexOf('[录音第 1 分钟起]'))
  expect(evidence).toContain('不据此确定每句说话人')
})

test('refines retained raw turns without rerunning the complete recording model, then reuses the refined checkpoint', async () => {
  jest.mocked(FS.stat).mockResolvedValue({ size: 1, mtime: 1, ctime: 1, name: 'original.m4a', path: '/original.m4a', mode: 0, originalFilepath: '/original.m4a', isFile: () => true, isDirectory: () => false })
  NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/asr-feature.wav') }
  NativeModules.MeetingSpeakers = { analyze: jest.fn(), embeddings: jest.fn(async (uri, windows) => windows.map(() => [1, 0, 0])) }
  const subscription = jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockReturnValue({ remove: jest.fn() })
  const checkpoint = { version: 1 as const, provider: 'sherpa-onnx-1.12.35' as const, source: { size: 1, modifiedMs: 1 }, duration: 30, turns: [0, 10, 20].map(start => ({ start, end: start + 3, speakerId: `speaker_${start}` })) }
  const save = jest.fn(), guard = jest.fn(async () => {})
  const result = await analyzeSpeakers('file:///original.m4a', { checkpoint, save, guard, progress: jest.fn() })
  expect(NativeModules.MeetingSpeakers.analyze).not.toHaveBeenCalled()
  expect(result.clusteringVersion).toBe(2)
  expect(result.clustering?.speakerCount).toBe(1)
  expect(result.turns[0].speakerId).toBe('speaker_r2_1')
  expect(save).toHaveBeenCalledTimes(2)
  expect(FS.unlink).toHaveBeenCalledWith('/cache/asr-feature.wav')
  NativeModules.MeetingSpeakers.embeddings.mockClear()
  await analyzeSpeakers('file:///original.m4a', { checkpoint: result, save, guard, progress: jest.fn() })
  expect(NativeModules.MeetingSpeakers.embeddings).not.toHaveBeenCalled()
  subscription.mockRestore()
})

describe('bounded long-recording speaker analysis', () => {
  const source = { size: 10000, modifiedMs: 1700000000000 }
  let remove: jest.Mock
  const control = () => ({ guard: async () => {}, progress: jest.fn(), save: jest.fn(async (_cp: SpeakerCheckpoint) => {}) })
  beforeEach(() => {
    jest.mocked(FS.stat).mockResolvedValue({ size: source.size, mtime: new Date(source.modifiedMs) } as never)
    NativeModules.MeetingAudio = { toWav: jest.fn(async () => 'file:///cache/asr-window.wav'), wavInfo: jest.fn(async () => 250) }
    NativeModules.MeetingSpeakers = {
      analyze: jest.fn(async () => { throw new Error('must not allocate whole recording') }),
      analyzeWindow: jest.fn(async (_uri, start, end) => ({ duration: end - start, segments: [{ start: 0, end: end - start, speaker: 0 }] })),
      embeddings: jest.fn(),
    }
    remove = jest.fn()
    jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockReturnValue({ remove })
    jest.spyOn(clustering, 'refineSpeakerGroups').mockImplementation(async turns => ({ turns: turns.map(turn => ({ ...turn, speakerId: 'speaker_unknown' })),
      clustering: { method: 'test-unknown', reliable: false, speakerCount: 0, rejectedGroups: 0, silhouette: 0, representativeTurns: 0, analyzedTurns: 0 } }))
  })
  afterEach(() => jest.restoreAllMocks())

  test.each([119, 120, 121, 1376.5485625])('iOS window bridge contract covers %ss without whole-file fallback (native mocked)', async duration => {
    jest.replaceProperty(Platform, 'OS', 'ios')
    NativeModules.MeetingAudio.wavInfo.mockResolvedValue(duration)
    const result = await analyzeSpeakers('file:///original.m4a', control())
    const calls: unknown[][] = NativeModules.MeetingSpeakers.analyzeWindow.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(args => Number(args[2]) - Number(args[1]) <= 130)).toBe(true)
    expect(Number(calls.at(-1)![2])).toBe(duration)
    expect(result.duration).toBe(duration)
    expect(result.turns[0].start).toBe(0)
    expect(result.turns.at(-1)?.end).toBe(duration)
    expect(result.analysis?.completedWindows).toBe(result.analysis?.totalWindows)
    expect(NativeModules.MeetingSpeakers.analyze).not.toHaveBeenCalled()
  })

  test('78m10s stays within 130s native windows and preserves the full recording offset', async () => {
    NativeModules.MeetingAudio.wavInfo.mockResolvedValue(4690)
    const saved = control()
    const result = await analyzeSpeakers('file:///original.m4a', saved)
    const windows: Array<[number, number]> = NativeModules.MeetingSpeakers.analyzeWindow.mock.calls.map((args: unknown[]) => [args[1], args[2]] as [number, number])
    expect(windows).toHaveLength(40)
    expect(windows.every(([start, end]) => end > start && end - start <= 130)).toBe(true)
    expect(windows[0]).toEqual([0, 125])
    expect(windows.at(-1)).toEqual([4675, 4690])
    expect(NativeModules.MeetingSpeakers.analyze).not.toHaveBeenCalled()
    expect(result.turns[0].start).toBe(0)
    expect(result.turns.at(-1)?.end).toBe(4690)
    expect(result.analysis).toMatchObject({ completedWindows: 40, totalWindows: 40 })
    expect(saved.progress).toHaveBeenCalledWith('检测发言区间 · 已保存 40/40 窗', expect.objectContaining({ phase: 'detection', percent: undefined }))
    expect(FS.unlink).not.toHaveBeenCalledWith('/original.m4a')
    expect(remove).toHaveBeenCalled()
  })

  test('context overlap is clipped at cores and repeated native labels do not imply the same speaker', async () => {
    const saved = control()
    await analyzeSpeakers('file:///original.m4a', saved)
    const raw = saved.save.mock.calls[2][0]
    expect(raw.turns.map(turn => [turn.start, turn.end])).toEqual([[0, 120], [120, 240], [240, 250]])
    expect(new Set(raw.turns.map(turn => turn.speakerId)).size).toBe(3)
    expect(raw.analysis).toMatchObject({ completedWindows: 3, totalWindows: 3 })
  })

  test('window failure retains the first durable window and restart only analyzes missing windows', async () => {
    const saved = control()
    NativeModules.MeetingSpeakers.analyzeWindow.mockRejectedValueOnce(new Error('native window failed'))
    // A failed first window must not fabricate any checkpoint.
    await expect(analyzeSpeakers('file:///original.m4a', saved)).rejects.toThrow('native window failed')
    expect(saved.save).not.toHaveBeenCalled()
    NativeModules.MeetingSpeakers.analyzeWindow.mockImplementationOnce(async (_uri: string, start: number, end: number) => ({ duration: end - start, segments: [{ start: 0, end: end - start, speaker: 0 }] }))
      .mockRejectedValueOnce(new Error('second window failed'))
    await expect(analyzeSpeakers('file:///original.m4a', saved)).rejects.toThrow('second window failed')
    const checkpoint = saved.save.mock.calls.at(-1)![0]
    expect(checkpoint.analysis?.completedWindows).toBe(1)
    expect(clustering.refineSpeakerGroups).not.toHaveBeenCalled()
    NativeModules.MeetingSpeakers.analyzeWindow.mockClear()
    await analyzeSpeakers('file:///original.m4a', { ...control(), checkpoint })
    expect(NativeModules.MeetingSpeakers.analyzeWindow.mock.calls.map((args: unknown[]) => args[1])).toEqual([115, 235])
    expect(checkpoint.analysis?.completedWindows).toBe(1)
  })

  test('old installed native module cannot fall back to whole-file analysis for long audio', async () => {
    delete NativeModules.MeetingSpeakers.analyzeWindow
    const saved = control()
    await expect(analyzeSpeakers('file:///original.m4a', saved)).rejects.toThrow('新版分窗')
    expect(NativeModules.MeetingSpeakers.analyze).not.toHaveBeenCalled()
    expect(saved.save).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalled()
  })

  test('an empty first window is durably covered and resumed without re-analysis', async () => {
    const saved = control()
    NativeModules.MeetingSpeakers.analyzeWindow.mockResolvedValueOnce({ duration: 125, segments: [] })
      .mockRejectedValueOnce(new Error('interrupted'))
    await expect(analyzeSpeakers('file:///original.m4a', saved)).rejects.toThrow('interrupted')
    const checkpoint = saved.save.mock.calls[0][0]
    expect(checkpoint.turns).toEqual([])
    expect(checkpoint.analysis?.completedWindows).toBe(1)
    NativeModules.MeetingSpeakers.analyzeWindow.mockClear()
    await analyzeSpeakers('file:///original.m4a', { ...control(), checkpoint })
    expect(NativeModules.MeetingSpeakers.analyzeWindow.mock.calls.map((args: unknown[]) => args[1])).toEqual([115, 235])
  })

  test('changed original invalidates a partial checkpoint instead of skipping unseen audio', async () => {
    const checkpoint: SpeakerCheckpoint = { version: 1, provider: 'sherpa-onnx-1.12.35', source: { ...source, size: 9 }, duration: 250,
      turns: [{ start: 0, end: 120, speakerId: 'old' }], analysis: { version: 2, windowSeconds: 120, completedWindows: 1, totalWindows: 3 } }
    await analyzeSpeakers('file:///original.m4a', { ...control(), checkpoint })
    expect(NativeModules.MeetingSpeakers.analyzeWindow.mock.calls[0][1]).toBe(0)
  })

  test('failed disk write cannot advance saved-window progress or enter refinement', async () => {
    const saved = control()
    saved.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(analyzeSpeakers('file:///original.m4a', saved)).rejects.toThrow('disk full')
    expect(NativeModules.MeetingSpeakers.analyzeWindow).toHaveBeenCalledTimes(1)
    expect(saved.progress.mock.calls.some(([text]) => text.includes('已保存 1/'))).toBe(false)
    expect(clustering.refineSpeakerGroups).not.toHaveBeenCalled()
  })
})
