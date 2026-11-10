import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from '../src/lib/storage'
import { integrationJson } from '../src/lib/integration'
import { queueAutomaticDelivery, flushAutomaticDeliveries } from '../src/lib/feishu'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn(), IntegrationError: class extends Error {} }))

test('concurrent legacy entries never replace the first unresolved snapshot', async () => {
  jest.mocked(readAccountId).mockResolvedValue('dedup-owner')
  await Promise.all([
    queueAutomaticDelivery({ id: 'same-note', title: '第一版', content: 'original' }, 'dedup-owner'),
    queueAutomaticDelivery({ id: 'same-note', title: '第二版', content: 'changed' }, 'dedup-owner'),
  ])
  expect(JSON.parse((await Storage.getItem('vinote:dedup-owner:feishu-outbox:same-note'))!)).toEqual({ id: 'same-note', title: '第一版', content: 'original' })
  expect(integrationJson).not.toHaveBeenCalled()
})

test('a changed account while reading the existing record does not write to the old outbox', async () => {
  jest.mocked(readAccountId).mockResolvedValueOnce('owner-before').mockResolvedValueOnce('owner-after')
  await queueAutomaticDelivery({ id: 'identity-change', title: '会议', content: '纪要' }, 'owner-before')
  expect(await Storage.getItem('vinote:owner-before:feishu-outbox:identity-change')).toBeNull()
  expect(integrationJson).not.toHaveBeenCalled()
})

test('unbound legacy outbox survives verification and account switching without a new POST', async () => {
  jest.mocked(readAccountId).mockResolvedValue('alice')
  await queueAutomaticDelivery({ id: 'note-a', title: '会议', content: '# 纪要' }, 'alice')
  const original = await Storage.getItem('vinote:alice:feishu-outbox:note-a')
  await expect(flushAutomaticDeliveries()).rejects.toThrow('旧发布记录待核验')
  jest.mocked(readAccountId).mockResolvedValue('bob')
  await expect(flushAutomaticDeliveries()).resolves.toBeUndefined()
  jest.mocked(readAccountId).mockResolvedValue('alice')
  await expect(flushAutomaticDeliveries()).rejects.toThrow('缺少原 operation ID')
  expect(await Storage.getItem('vinote:alice:feishu-outbox:note-a')).toBe(original)
  expect(integrationJson).not.toHaveBeenCalled()
})
