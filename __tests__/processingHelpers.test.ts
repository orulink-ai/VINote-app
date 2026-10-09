import { createSerialQueue, mapConcurrent } from '../src/lib/processingHelpers'

test('bounded work starts two requests together and keeps source order', async () => {
  let active = 0
  let peak = 0
  const release: Array<() => void> = []
  const work = mapConcurrent([0, 1, 2], 2, async value => {
    active++; peak = Math.max(peak, active)
    await new Promise<void>(resolve => { release[value] = resolve })
    active--
    return value
  })
  await Promise.resolve()
  expect(release[0]).toBeDefined()
  expect(release[1]).toBeDefined()
  expect(release[2]).toBeUndefined()
  release[1]()
  await new Promise<void>(resolve => setImmediate(resolve))
  release[2]()
  release[0]()
  await expect(work).resolves.toEqual([0, 1, 2])
  expect(peak).toBe(2)
})

test('failure stops new work and waits for in-flight checkpoints to settle', async () => {
  let finish: () => void = () => {}
  const visited: number[] = []
  const work = mapConcurrent([0, 1, 2], 2, async value => {
    visited.push(value)
    if (value === 0) throw new Error('network')
    await new Promise<void>(resolve => { finish = resolve })
    return value
  })
  let settled = false
  const assertion = expect(work.finally(() => { settled = true })).rejects.toThrow('network')
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(settled).toBe(false)
  expect(visited).toEqual([0, 1])
  finish()
  await assertion
})

test('checkpoint writes never overlap and a failed write remains visible', async () => {
  const queue = createSerialQueue()
  const order: number[] = []
  let release: () => void = () => {}
  const first = queue(async () => {
    order.push(1)
    await new Promise<void>(resolve => { release = resolve })
    throw new Error('disk')
  })
  const assertion = expect(first).rejects.toThrow('disk')
  const second = queue(async () => { order.push(2); return 'saved' })
  await Promise.resolve()
  expect(order).toEqual([1])
  release()
  await assertion
  await expect(second).resolves.toBe('saved')
  expect(order).toEqual([1, 2])
})
