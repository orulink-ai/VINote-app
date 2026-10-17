import { clusterSpeakerFeatures, refineSpeakerGroups } from '../src/lib/speakerClustering'

test('separates sustained voices while similar embeddings stay together', () => {
  const grouped = clusterSpeakerFeatures([[1, 0], [0.99, 0.01], [0.98, 0.02], [0, 1], [0.01, 0.99], [0.02, 0.98]])
  expect(new Set(grouped.labels).size).toBe(2)
  expect(grouped.labels[0]).toBe(grouped.labels[2])
  expect(grouped.labels[0]).not.toBe(grouped.labels[3])
  expect(grouped.score).toBeGreaterThan(0.2)
  expect(clusterSpeakerFeatures([[1, 0], [0.99, 0.01], [0.98, 0.02]]).labels).toEqual([0, 0, 0])
})

test('bounds feature memory and leaves unsupported short turns unknown without inheriting old aliases', async () => {
  const turns = Array.from({ length: 300 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, speakerId: `speaker_${i + 1}` }))
  turns.push({ start: 3000, end: 3000.3, speakerId: 'speaker_1' }, { start: 3001, end: 3002, speakerId: 'speaker_overlap' })
  const extract = jest.fn(async windows => windows.map((window: { start: number }) => (window.start / 10) % 2 ? [0, 1] : [1, 0]))
  const result = await refineSpeakerGroups(turns, extract)
  expect(extract).toHaveBeenCalledTimes(2)
  expect(extract.mock.calls.every(([windows]) => windows.length <= 128 && windows.every((window: { start: number; end: number }) => window.end - window.start <= 8))).toBe(true)
  expect(result.clustering.speakerCount).toBe(2)
  expect(result.clustering.analyzedTurns).toBe(256)
  expect(result.turns.some(turn => turn.speakerId === 'speaker_r2_1')).toBe(true)
  expect(result.turns.find(turn => turn.start === 3000)?.speakerId).toBe('speaker_unknown')
  expect(result.turns.find(turn => turn.start === 3001)?.speakerId).toBe('speaker_overlap')
})

test('missing feature vectors never produce claimed identities', async () => {
  const result = await refineSpeakerGroups([{ start: 0, end: 3, speakerId: 'speaker_1' }], async windows => windows.map(() => null))
  expect(result.turns[0].speakerId).toBe('speaker_unknown')
  expect(result.clustering.reliable).toBe(false)
})

test('a single short outlier does not become a second speaker or get reassigned to the main voice', async () => {
  const turns = [0, 10, 20, 30].map((start, i) => ({ start, end: start + (i === 3 ? 1.6 : 4), speakerId: `speaker_${i}` }))
  const result = await refineSpeakerGroups(turns, async windows => windows.map(window => window.start === 30 ? [0, 1] : [1, 0]))
  expect(result.clustering.speakerCount).toBe(1)
  expect(result.turns.find(turn => turn.start === 30)?.speakerId).toBe('speaker_unknown')
})
