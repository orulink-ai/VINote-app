import type { SpeakerTurn } from './meetingSpeakers'

const normalize = (vector: number[]) => {
  const norm = Math.hypot(...vector)
  return vector.map(value => value / Math.max(norm, 1e-8))
}
const similarity = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)

/** Bounded average linkage and silhouette selection, matching desktop policy. */
export function clusterSpeakerFeatures(features: number[][]) {
  const vectors = features.map(normalize), n = vectors.length
  if (!n) return { labels: [], score: 0 }
  const distance = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : Math.min(2, Math.max(0, 1 - similarity(vectors[i], vectors[j])))))
  const pairs = distance.flatMap((row, i) => row.slice(i + 1)).sort((a, b) => a - b)
  if (n < 3 || pairs[Math.floor((pairs.length - 1) * 0.9)] < 0.4) return { labels: Array(n).fill(0) as number[], score: 0 }
  const linkage = distance.map(row => [...row])
  const groups = new Map(vectors.map((_, i) => [i, [i]]))
  let best: number[][] | undefined, bestScore = -1
  while (groups.size > 1) {
    if (groups.size <= Math.min(20, n - 1)) {
      let total = 0
      for (const [id, group] of groups) for (const index of group) {
        if (group.length < 2) continue
        const within = group.reduce((sum, other) => sum + distance[index][other], 0) / (group.length - 1)
        const between = Math.min(...[...groups].filter(([key]) => key !== id).map(([, other]) => other.reduce((sum, item) => sum + distance[index][item], 0) / other.length))
        total += (between - within) / Math.max(within, between, 1e-8)
      }
      const score = total / n
      if (score > bestScore) { best = [...groups.values()].map(group => [...group]); bestScore = score }
    }
    let closest = Infinity, left = -1, right = -1
    const ids = [...groups.keys()]
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (linkage[ids[i]][ids[j]] < closest) { closest = linkage[ids[i]][ids[j]]; left = ids[i]; right = ids[j] }
    }
    const a = groups.get(left)!, b = groups.get(right)!
    for (const id of ids) if (id !== left && id !== right) {
      linkage[left][id] = linkage[id][left] = (linkage[left][id] * a.length + linkage[right][id] * b.length) / (a.length + b.length)
    }
    a.push(...b); groups.delete(right)
  }
  const labels = Array(n).fill(0) as number[]
  ;(best || [...groups.values()]).forEach((group, label) => group.forEach(index => { labels[index] = label }))
  return { labels, score: bestScore }
}

export async function refineSpeakerGroups(turns: SpeakerTurn[], extract: (windows: { start: number; end: number }[]) => Promise<(number[] | null)[]>) {
  const candidates = turns.map((turn, i) => ({ ...turn, i })).filter(turn => turn.speakerId !== 'speaker_overlap' && turn.end - turn.start >= 1.5)
  const representatives = candidates.length <= 128 ? candidates : Array.from({ length: 128 }, (_, i) => candidates[Math.floor(i * (candidates.length - 1) / 127)])
  const chosen = new Set(representatives.map(turn => turn.i))
  const additional = turns.map((turn, i) => ({ ...turn, i })).filter(turn => turn.speakerId !== 'speaker_overlap' && !chosen.has(turn.i) && turn.end - turn.start >= 0.6).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 128)
  const selected = [...representatives, ...additional]
  const vectors = new Map<number, number[]>()
  for (let start = 0; start < selected.length; start += 128) {
    const batch = selected.slice(start, start + 128)
    const features = await extract(batch.map(turn => ({ start: turn.start, end: Math.min(turn.end, turn.start + 8) })))
    if (!Array.isArray(features) || features.length !== batch.length) throw new Error('声音特征分析结果不完整')
    features.forEach((vector, i) => {
      if (vector && vector.length && vector.every(Number.isFinite) && Math.hypot(...vector) > 1e-8) vectors.set(batch[i].i, normalize(vector))
    })
  }
  const keys = representatives.map(turn => turn.i).filter(i => vectors.has(i))
  const { labels, score } = clusterSpeakerFeatures(keys.map(i => vectors.get(i)!))
  const groups = [...new Set(labels)].sort((a, b) => a - b)
  // A brief isolated outlier is not evidence for another person. Keep rejected
  // centroids as competitors so their turns are not forced onto a valid voice.
  const supported = new Map(groups.filter(label => {
    const members = keys.filter((_, i) => labels[i] === label)
    return members.length >= 2 && members.reduce((sum, key) => sum + Math.min(8, turns[key].end - turns[key].start), 0) >= 6
  }).map((label, i) => [label, i]))
  const reliable = keys.length >= 3 && supported.size > 0 && (groups.length === 1 || score >= 0.2)
  const direct = new Map(keys.map((key, i) => [key, labels[i]]))
  const centroids = groups.map(label => {
    const members = keys.filter((_, i) => labels[i] === label).map(key => vectors.get(key)!)
    return normalize(members[0].map((_, i) => members.reduce((sum, vector) => sum + vector[i], 0) / members.length))
  })
  const refined: SpeakerTurn[] = []
  turns.forEach((turn, index) => {
    let id = turn.speakerId === 'speaker_overlap' ? 'speaker_overlap' : 'speaker_unknown'
    if (reliable && direct.has(index) && supported.has(direct.get(index)!)) id = `speaker_r2_${supported.get(direct.get(index)!)! + 1}`
    else if (reliable && vectors.has(index)) {
      const scores = centroids.map((vector, i) => ({ label: groups[i], score: similarity(vector, vectors.get(index)!) })).sort((a, b) => b.score - a.score)
      if (supported.has(scores[0].label) && scores[0].score >= 0.45 && (scores.length === 1 || scores[0].score - scores[1].score >= 0.08)) id = `speaker_r2_${supported.get(scores[0].label)! + 1}`
    }
    const previous = refined.at(-1)
    if (previous?.speakerId === id && turn.start - previous.end <= 1) previous.end = turn.end
    else refined.push({ start: turn.start, end: turn.end, speakerId: id })
  })
  return { turns: refined, clustering: { method: 'sustained-turn-average-linkage', reliable, speakerCount: reliable ? supported.size : 0, rejectedGroups: groups.length - supported.size, silhouette: score, representativeTurns: keys.length, analyzedTurns: vectors.size } }
}
