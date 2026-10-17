import { contactRecipients, contactsValid, feishuContacts, feishuPublishBody } from '../src/lib/feishu'
import { integrationJson } from '../src/lib/integration'
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/integration', () => ({ integrationJson: jest.fn(), IntegrationError: class extends Error {} }))
beforeEach(() => jest.clearAllMocks())
const contact = { open_id: 'ou_one', name: '真实姓名', selection_token: 'opaque-proof', expiresAt: Date.now() + 900000 }
test('search uses owner-bound GET, escapes the original cursor, and gives a selection lifetime', async () => {
  jest.mocked(integrationJson).mockResolvedValue({ items: [contact], has_more: true, page_token: 'next', selection_expires_in: 900 })
  const result = await feishuContacts('张 & 李', 'a&b', 'owner')
  expect(integrationJson).toHaveBeenCalledWith(expect.stringContaining('page_token=a%26b'), { headers: { 'Cache-Control': 'no-cache' } }, 'owner')
  expect(contactsValid(result.items)).toBe(true)
  expect(result.items[0].expiresAt).toBeLessThanOrEqual(Date.now() + 900000)
})
test('the publish serializer excludes local display evidence and retired sync references', () => {
  const original = JSON.stringify(contact)
  const body = feishuPublishBody('note', 'title', 'body', false, { operation_id: 'op', contacts: [contact], version_id: 'retired', revision_id: '1' })
  expect(body.contacts).toEqual(contactRecipients([contact]))
  expect(body.contacts).toEqual([{ open_id: 'ou_one', selection_token: 'opaque-proof' }])
  expect(body).not.toHaveProperty('version_id'); expect(body).not.toHaveProperty('revision_id')
  expect(body.source_mode).toBe('local_snapshot')
  expect(JSON.stringify(contact)).toBe(original)
  expect(contactsValid([{ ...contact, expiresAt: 1 }])).toBe(false)
})
test('invalid pagination cannot be treated as no matching contacts', async () => {
  jest.mocked(integrationJson).mockResolvedValue({ items: [], has_more: true, page_token: '', selection_expires_in: 900 })
  await expect(feishuContacts('姓名', '', 'owner')).rejects.toThrow('未核验')
})
