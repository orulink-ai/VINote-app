import { deliverySettingsReturn, takeDeliveryReturn } from '../src/lib/feishuDeliveryReturn'
import { transitionIdentity } from '../src/lib/sessionIdentity'
import { readAccountId } from '../src/lib/storage'
import { readPublishDraft } from '../src/lib/feishuPublishReceipt'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/feishuPublishReceipt', () => ({ readPublishDraft: jest.fn(async () => ({ operationId: 'op' })) }))
const request = () => deliverySettingsReturn('saved', { owner: 'owner', noteKey: 'key', operationId: 'op' } as never)
beforeEach(() => { jest.mocked(readAccountId).mockResolvedValue('owner'); jest.mocked(readPublishDraft).mockResolvedValue({ operationId: 'op' } as never) })
test('same saved content and original operation restore once', async () => {
  const value = request()
  expect(await takeDeliveryReturn(value, 'saved', 'key')).toBe(true)
  expect(await takeDeliveryReturn(value, 'saved', 'key')).toBe(false)
})
test('different note/key/account and replaced or missing operation cannot restore', async () => {
  expect(await takeDeliveryReturn(request(), 'other', 'key')).toBe(false)
  expect(await takeDeliveryReturn(request(), 'saved', 'other')).toBe(false)
  jest.mocked(readAccountId).mockResolvedValue('other')
  expect(await takeDeliveryReturn(request(), 'saved', 'key')).toBe(false)
  jest.mocked(readAccountId).mockResolvedValue('owner')
  jest.mocked(readPublishDraft).mockResolvedValue({ operationId: 'new' } as never)
  expect(await takeDeliveryReturn(request(), 'saved', 'key')).toBe(false)
  jest.mocked(readPublishDraft).mockResolvedValue(null)
  expect(await takeDeliveryReturn(request(), 'saved', 'key')).toBe(false)
})
test('ABA during settings or delayed receipt read rejects restoration', async () => {
  let value = request(); transitionIdentity('other'); transitionIdentity('owner')
  expect(await takeDeliveryReturn(value, 'saved', 'key')).toBe(false)
  value = request()
  jest.mocked(readPublishDraft).mockImplementationOnce(async () => { transitionIdentity('other'); transitionIdentity('owner'); return { operationId: 'op' } as never })
  expect(await takeDeliveryReturn(value, 'saved', 'key')).toBe(false)
})
test('unreadable storage does not reopen or dispatch', async () => {
  jest.mocked(readAccountId).mockRejectedValueOnce(Error('unreadable'))
  expect(await takeDeliveryReturn(request(), 'saved', 'key')).toBe(false)
})
