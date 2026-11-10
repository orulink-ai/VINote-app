import Storage from '@react-native-async-storage/async-storage'
import { readAccountId } from '../src/lib/storage'
import { integrationJson } from '../src/lib/integration'
import { queueAutomaticDelivery, flushAutomaticDeliveries } from '../src/lib/feishu'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn(), IntegrationError: class extends Error {} }))

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