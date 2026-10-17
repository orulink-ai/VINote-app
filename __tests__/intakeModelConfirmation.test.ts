import { parseIntakeModelContext, sameIntakeModelContext } from '../src/lib/intakeModelConfirmation'
jest.mock('../src/lib/integration', () => ({ generationBaseUrl: 'https://generation.example', integrationJson: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))
jest.mock('../src/lib/noteIntake', () => ({ readIntake: jest.fn() }))
const context = { task_id: 'task', source: { title: '文档', type: 'document' }, requires_confirmation: true, can_confirm: true,
  selection: { mode: 'cloud', server_url: 'https://model.example', asr_model: 'asr', llm_model: 'llm' } }
test.each(['https://user:secret@model.example', 'https://model.example?secret=value', 'https://model.example#value', 'file:///model', 'invalid'])('unsafe model origin is rejected: %s', server_url => {
  expect(() => parseIntakeModelContext({ ...context, selection: { ...context.selection, server_url } }, 'task')).toThrow('来源无效')
})
test('missing protocol, wrong task and incomplete models fail closed', () => {
  for (const value of [null, { ...context, task_id: 'other' }, { ...context, requires_confirmation: undefined },
    { ...context, can_confirm: undefined }, { ...context, selection: { ...context.selection, asr_model: '' } }]) expect(() => parseIntakeModelContext(value, 'task')).toThrow()
})
test('confirmation retains only required selection and detects source/model changes', () => {
  const parsed = parseIntakeModelContext({ ...context, selection: { ...context.selection, extra: 'ignored' } }, 'task')
  expect(parsed.selection).toEqual(context.selection)
  expect(sameIntakeModelContext(parsed, parseIntakeModelContext(context, 'task'))).toBe(true)
  expect(sameIntakeModelContext(parsed, { ...parsed, source: { ...parsed.source, title: 'changed' } })).toBe(false)
  expect(sameIntakeModelContext(parsed, { ...parsed, selection: { ...parsed.selection!, llm_model: 'changed' } })).toBe(false)
})
