import { createSampleClockPacer } from '../src/lib/asrPacing'
test('200ms sample budget includes native read/bridge work rather than adding it', async () => {
  let time = 0; const sends: number[] = []
  const pace = createSampleClockPacer(() => time, async ms => { time += ms })
  for (let i = 0; i < 100; i++) { const wait = pace.begin(6400); time += 40; sends.push(time); await wait() }
  expect(time).toBe(20000); expect(sends[99]).toBe(19840)
  expect(100 * (200 + 40)).toBe(24000) // Counterexample: old post-read fixed sleep.
})
test('partial packet uses actual sample count, not a fixed 200ms delay', async () => {
  let time = 0; const delays: number[] = []
  const pace = createSampleClockPacer(() => time, async ms => { delays.push(ms); time += ms })
  const wait = pace.begin(3200); time += 25; await wait()
  expect(delays).toEqual([75]); expect(time).toBe(100)
})
test('five minute suspension never accumulates catch-up packets', async () => {
  let time = 0; let calls = 0
  const pace = createSampleClockPacer(() => time, async ms => { time += ms + (calls++ === 0 ? 300000 : 0) })
  await pace.begin(6400)(); const resumed = time
  await pace.begin(6400)(); expect(time - resumed).toBe(200)
})
test('read overrun reserves a fresh budget instead of immediate burst', async () => {
  let time = 0
  const pace = createSampleClockPacer(() => time, async ms => { time += ms })
  const wait = pace.begin(6400); time += 500; await wait(); expect(time).toBe(700)
})
test('early timer wake cannot send before sample deadline', async () => {
  let time = 0; let calls = 0
  const pace = createSampleClockPacer(() => time, async ms => { time += calls++ === 0 ? ms / 2 : ms })
  await pace.begin(6400)(); expect(time).toBe(200); expect(calls).toBe(2)
})
test('fresh attempt has no prior sample debt and invalid samples fail closed', async () => {
  let time = 10000
  const pace = createSampleClockPacer(() => time, async ms => { time += ms })
  expect(() => pace.begin(6401)).toThrow('PCM_FRAME_INVALID')
  await pace.begin(6400)(); expect(time).toBe(10200)
  expect(() => createSampleClockPacer(() => NaN).begin(6400)).toThrow('PCM_CLOCK_INVALID')
})
test('a packet budget cannot be waited twice', async () => {
  let time = 0
  const wait = createSampleClockPacer(() => time, async ms => { time += ms }).begin(6400)
  await wait(); await expect(wait()).rejects.toThrow('PCM_PACE_DUPLICATE')
})
