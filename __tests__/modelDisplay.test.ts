import { modelDisplay } from '../src/lib/modelDisplay'
test('actual public catalog distinguishes providers without decoding routing IDs', () => {
  expect(modelDisplay({ id: 'opaque-a', modelType: 'asr', runtimeStatus: 'available', providerId: 'aliyun', providerModel: 'paraformer-realtime-v2' }, 'asr')).toBe('阿里云 · paraformer-realtime-v2')
  expect(modelDisplay({ id: 'opaque-b', modelType: 'asr', runtimeStatus: 'available', providerId: 'volcengine-asr', providerModel: 'bigmodel' }, 'asr')).toBe('豆包 · bigmodel')
})
test('unknown or malformed catalog never guesses the routing ID and rows stay distinguishable', () => {
  const model = { id: 'asr:opaque-internal', name: 'asr:opaque-internal', modelType: 'asr' as const, runtimeStatus: 'available', providerModel: 'bad\nvalue' }
  expect(modelDisplay(model, 'asr', 2)).toBe('语音模型 2')
  expect(modelDisplay(undefined, 'asr')).toBe('已选语音模型')
})

test.each([
  ['deepseek-v4.1-flash', 'aliyun-token-plan-openai', 'deepseek-v4.1-flash'],
  ['codex/gpt-6-luna', 'codex', 'Codex · codex/gpt-6-luna'],
])('public providerModel may equal catalog id: %s', (id, providerId, expected) => {
  expect(modelDisplay({ id, providerModel: id, providerId, modelType: 'llm', runtimeStatus: 'available' }, 'llm', 1)).toBe(expected)
})

test.each(['asr:14:volcengine-asr:8:bigmodel', 'llm:14:private:8:model',
  'bad\nvalue', 'bad\u007fvalue', 'bad\u0085value', 'x'.repeat(121)])('public providerModel still rejects opaque or unsafe values: %s', value => {
  for (const id of [value, 'different-routing-id']) {
    expect(modelDisplay({ id, providerModel: value, modelType: 'llm', runtimeStatus: 'available' }, 'llm', 2)).toBe('总结模型 2')
  }
})

test('name equal to id alone still cannot expose the routing id', () => {
  expect(modelDisplay({ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash',
    modelType: 'llm', runtimeStatus: 'available' }, 'llm', 1)).toBe('总结模型 1')
})
