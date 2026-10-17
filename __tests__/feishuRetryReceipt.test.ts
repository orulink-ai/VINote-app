import Storage from '@react-native-async-storage/async-storage'
import { beginRetryReceipt, readRetryReceipt, queryRetryReceipt } from '../src/lib/feishuRetryReceipt'
import { deliveryById, type Delivery } from '../src/lib/feishu'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationBaseUrl: 'https://shared.example' }))
jest.mock('../src/lib/feishu', () => ({ deliveryById: jest.fn() }))
const job = (status: Delivery['status'], id = 'original', phase = 'failed'): Delivery => ({ id, status, phase, recipients: {}, document_url: '', error: '' })
beforeEach(async () => {
  jest.clearAllMocks()
  jest.mocked(readAccountId).mockResolvedValue('owner')
  for (const key of await Storage.getAllKeys()) await Storage.removeItem(key)
})
test('old failed GET and 404 preserve the same durable job and forbid a second retry', async () => {
  const pending = await beginRetryReceipt('owner', 'note', 'original')
  jest.mocked(deliveryById).mockResolvedValue(job('failed'))
  expect((await queryRetryReceipt(pending)).pending).toEqual(pending)
  await expect(beginRetryReceipt('owner', 'note', 'different')).rejects.toThrow('尚未确认')
  jest.mocked(deliveryById).mockRejectedValue(new Error('404'))
  await expect(queryRetryReceipt(pending)).rejects.toThrow('404')
  expect(await readRetryReceipt('owner', 'note')).toEqual(pending)
  expect(deliveryById).toHaveBeenCalledWith('original', 'owner')
})
test('wrong ID cannot clear pending; only observed running then known failure resolves it', async () => {
  const pending = await beginRetryReceipt('owner', 'note', 'original')
  jest.mocked(deliveryById).mockResolvedValue(job('completed', 'other'))
  await expect(queryRetryReceipt(pending)).rejects.toThrow('不属于')
  jest.mocked(deliveryById).mockResolvedValue(job('processing', 'original', 'writing'))
  expect((await queryRetryReceipt(pending)).pending?.observedRunning).toBe(true)
  jest.mocked(deliveryById).mockResolvedValue(job('failed', 'original', 'unknown'))
  expect((await queryRetryReceipt(pending)).pending).not.toBeNull()
  jest.mocked(deliveryById).mockResolvedValue(job('failed'))
  expect((await queryRetryReceipt(pending)).pending).toBeNull()
  expect(await readRetryReceipt('owner', 'note')).toBeNull()
})
test('completed exact GET resolves pending', async () => {
  const pending = await beginRetryReceipt('owner', 'note', 'original')
  jest.mocked(deliveryById).mockResolvedValue(job('completed', 'original', 'completed'))
  expect((await queryRetryReceipt(pending)).pending).toBeNull()
})
test('serialized concurrent begin allows one dispatch marker; storage failure never reports success', async () => {
  const results = await Promise.allSettled([beginRetryReceipt('owner', 'note', 'original'), beginRetryReceipt('owner', 'note', 'original')])
  expect(results.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
  jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk failed'))
  await expect(beginRetryReceipt('owner', 'other-note', 'original')).rejects.toThrow('disk failed')
  expect(await readRetryReceipt('owner', 'other-note')).toBeNull()
})
test('A-B-A while GET is delayed cannot clear old-account uncertainty', async () => {
  const pending = await beginRetryReceipt('owner', 'note', 'original')
  let finish!: (value: Delivery) => void
  const started = new Promise<void>(resolve => jest.mocked(deliveryById).mockImplementation(() => { resolve(); return new Promise(done => { finish = done }) }))
  const result = queryRetryReceipt(pending)
  const rejected = expect(result).rejects.toThrow('账号已切换')
  await started
  transitionIdentity('B'); transitionIdentity('owner')
  finish(job('completed', 'original', 'completed'))
  await rejected
  expect(await readRetryReceipt('owner', 'note')).toEqual(pending)
  jest.mocked(readAccountId).mockResolvedValue('B')
  expect(await readRetryReceipt('B', 'note')).toBeNull()
})
