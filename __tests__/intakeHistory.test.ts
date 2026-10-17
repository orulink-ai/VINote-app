import { intakeHistoryRecord, readCurrentIntakeHistory, sameIntakeHistoryTarget } from '../src/lib/intakeHistory'
import { readIntake } from '../src/lib/noteIntake'
import { readAccountId, sessionRevision } from '../src/lib/storage'

jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://source.example' }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(), sessionRevision: jest.fn() }))
jest.mock('../src/lib/noteIntake', () => ({ readIntake: jest.fn(), intakeFileName: jest.fn(file => file.name), recoverIntake: jest.fn(), inspectIntake: jest.fn(), submitIntake: jest.fn(), writeIntake: jest.fn() }))
const origin = 'https://source.example'
const pending = { mode: 'url' as const, url: 'https://example.org/doc', operationId: 'original-operation', generationOrigin: origin, uncertain: true, receiptState: 'unknown' as const }
beforeEach(() => { jest.clearAllMocks(); (readAccountId as jest.Mock).mockResolvedValue('owner'); (sessionRevision as jest.Mock).mockReturnValue(1); (readIntake as jest.Mock).mockResolvedValue(pending) })

test('ordinary input and cleared current slot do not become history tasks', () => {
  expect(intakeHistoryRecord('owner', { mode: 'url', url: 'https://example.org/draft' }, origin)).toBeNull()
  expect(intakeHistoryRecord('owner', { mode: 'file', url: '' }, origin)).toBeNull()
  expect(intakeHistoryRecord('owner', { mode: 'url', url: '', uncertain: true }, origin)).toBeNull()
})
test('only exact recorded service can yield a bound navigation target', () => {
  const known = intakeHistoryRecord('owner', pending, origin)!
  expect(known.target).toEqual({ owner: 'owner', generationOrigin: origin, operationId: 'original-operation', taskId: undefined })
  expect(intakeHistoryRecord('owner', { ...pending, generationOrigin: undefined }, origin)).toMatchObject({ status: '原服务未记录，暂不能安全核验', target: undefined })
  expect(intakeHistoryRecord('owner', pending, 'https://different.example')).toMatchObject({ status: '原提交属于其他处理服务', target: undefined })
  expect(intakeHistoryRecord('owner', pending, '')!.target).toBeUndefined()
})
test('receipt labels never assert execution failure, success or saved content', () => {
  expect(intakeHistoryRecord('owner', pending, origin)!.status).toBe('提交结果待核验')
  expect(intakeHistoryRecord('owner', { ...pending, taskId: 'task', receiptState: 'reserved' }, origin)!.status).toBe('已登记，受理待确认')
  expect(intakeHistoryRecord('owner', { ...pending, taskId: 'task', uncertain: false, receiptState: 'accepted' }, origin)).toMatchObject({ status: '任务已受理，结果待查询', action: '查看原任务' })
})
test('reads only the owner current slot without recovery or mutation', async () => {
  expect(await readCurrentIntakeHistory('owner')).toMatchObject({ status: '提交结果待核验' })
  expect(readIntake).toHaveBeenCalledWith('owner')
  const module = jest.requireMock('../src/lib/noteIntake')
  for (const name of ['recoverIntake', 'inspectIntake', 'submitIntake', 'writeIntake']) expect(module[name]).not.toHaveBeenCalled()
})
test('rejects owner switch before reading and late switch after reading', async () => {
  ;(readAccountId as jest.Mock).mockResolvedValueOnce('other')
  await expect(readCurrentIntakeHistory('owner')).rejects.toThrow('账号会话已变化')
  expect(readIntake).not.toHaveBeenCalled()
  ;(readAccountId as jest.Mock).mockResolvedValueOnce('owner').mockResolvedValueOnce('other')
  await expect(readCurrentIntakeHistory('owner')).rejects.toThrow('账号会话已变化')
})
test('rejects same-owner session replacement during reading', async () => {
  ;(readIntake as jest.Mock).mockImplementationOnce(async () => { (sessionRevision as jest.Mock).mockReturnValue(2); return pending })
  await expect(readCurrentIntakeHistory('owner')).rejects.toThrow('账号会话已变化')
})
test('changed operation, task, owner and origin are never rebound implicitly', () => {
  const target = { owner: 'owner', generationOrigin: origin, operationId: 'op', taskId: 'task' }
  expect(sameIntakeHistoryTarget(target, { ...target })).toBe(true)
  for (const changed of [{ ...target, operationId: 'new' }, { ...target, taskId: 'new' }, { ...target, owner: 'other' }, { ...target, generationOrigin: 'other' }, undefined]) expect(sameIntakeHistoryTarget(target, changed)).toBe(false)
})
