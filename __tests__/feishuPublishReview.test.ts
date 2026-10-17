import { feishuApi, type PublishOptions } from '../src/lib/feishu'
import { readAccountId } from '../src/lib/storage'
import { hasPublishReview, reviewPublishOptions } from '../src/lib/feishuPublishReview'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/feishu', () => ({ feishuApi: jest.fn() }))

test.each(['service_unavailable', 'grant_unavailable'])('temporary verification failure cannot confirm group objects: %s', async state => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => path === '/status'
    ? { publish_receipt_protocol: 1, connected: true, expired: false, name: '原身份',
        ...(state === 'service_unavailable' ? { connection_state: state } : { grant_state: 'unavailable' }) }
    : api(path, ...args))
  await expect(reviewPublishOptions('owner', options)).rejects.toThrow('暂时无法核验飞书连接')
})
const options: PublishOptions = { destination_config: { kind: 'folder', folder_token: 'real-folder' }, permission_policy: 'inherit', notify_self: true, groups: ['g2', 'g1'] }
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('owner')
  jest.mocked(feishuApi).mockImplementation(async path => {
    if (path === '/status') return { publish_receipt_protocol: 1, connected: true, expired: false, name: '飞书用户甲' }
    if (path === '/groups') return [{ chat_id: 'g1', name: '项目一群' }, { chat_id: 'g2', name: '项目二群' }, { chat_id: 'other', name: '未选群' }]
    return { name: '会议资料', path: ['会议资料'], path_complete: false, can_attempt_create: true, can_create: false }
  })
})
test('binds exact selected names and self to a real path fragment without claiming create/read permission', async () => {
  const result = await reviewPublishOptions('owner', options)
  expect(result).toMatchObject({ selfName: '飞书用户甲', groups: [{ chat_id: 'g2', name: '项目二群' }, { chat_id: 'g1', name: '项目一群' }], destination: { path: ['会议资料'], path_complete: false, can_create: false } })
  expect(hasPublishReview(options, result)).toBe(true)
  expect(hasPublishReview({ ...options, groups: ['other'] }, result)).toBe(false)
  expect(hasPublishReview({ ...options, destination_config: { kind: 'folder', folder_token: 'different' } }, result)).toBe(false)
  expect(jest.mocked(feishuApi).mock.calls.every(([, , owner]) => owner === 'owner')).toBe(true)
})
test('group read failure cannot produce a reviewed recipient list', async () => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => { if (path === '/groups') throw new Error('群读取失败'); return api(path, ...args) })
  await expect(reviewPublishOptions('owner', options)).rejects.toThrow('群读取失败')
})
test.each(['missing-group', 'missing-self', 'missing-position', 'generic-position', 'no-capability'])('rejects unavailable evidence: %s', async missing => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => {
    if (path === '/groups' && missing === 'missing-group') return []
    if (path === '/status' && missing === 'missing-self') return { publish_receipt_protocol: 1, connected: true, name: '' }
    if (path === '/destinations/check' && missing === 'missing-position') return { can_attempt_create: true, path: [], name: '' }
    if (path === '/destinations/check' && missing === 'generic-position') return { can_attempt_create: true, path: ['文件夹'], name: '文件夹' }
    if (path === '/destinations/check' && missing === 'no-capability') return { can_attempt_create: false, reason: '无创建能力' }
    return api(path, ...args)
  })
  await expect(reviewPublishOptions('owner', options)).rejects.toThrow()
})
test('no notifications neither loads groups nor requires a self name', async () => {
  const none: PublishOptions = { destination_config: { kind: 'personal' }, notify_self: false, groups: [] }
  const result = await reviewPublishOptions('owner', none)
  expect(result.groups).toEqual([]); expect(result.selfName).toBeUndefined()
  expect(feishuApi).not.toHaveBeenCalledWith('/groups', {}, 'owner')
  expect(hasPublishReview(none, result)).toBe(true)
})
test('owner switch after response cannot confirm or store another account identity', async () => {
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => {
    const response = await api(path, ...args); jest.mocked(readAccountId).mockResolvedValue('other'); return response
  })
  await expect(reviewPublishOptions('owner', options)).rejects.toThrow('账号已切换')
})

test('contact identity, proof, and display name bind the review; old protocol never confirms contacts', async () => {
  const selected = { ...options, contacts: [{ open_id: 'ou_one', selection_token: 'proof', name: '原联系人' }] }
  await expect(reviewPublishOptions('owner', selected)).rejects.toThrow('尚未支持联系人选择')
  const api = jest.mocked(feishuApi).getMockImplementation()!
  jest.mocked(feishuApi).mockImplementation(async (path, ...args) => path === '/status' ? { publish_receipt_protocol: 1, contact_selection_protocol: 1, connected: true, name: '飞书用户甲' } : api(path, ...args))
  const review = await reviewPublishOptions('owner', selected)
  expect(review.contacts).toEqual([{ open_id: 'ou_one', name: '原联系人' }])
  expect(hasPublishReview(selected, review)).toBe(true)
  expect(hasPublishReview({ ...selected, contacts: [{ ...selected.contacts[0], name: '不同姓名' }] }, review)).toBe(false)
  expect(hasPublishReview({ ...selected, contacts: [{ ...selected.contacts[0], selection_token: 'new-proof' }] }, review)).toBe(false)
})
