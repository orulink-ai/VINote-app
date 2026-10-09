import { apiJson } from '../src/lib/api'
import { readAccountId } from '../src/lib/storage'
import { loadModels } from '../src/lib/models'

jest.mock('../src/lib/api', () => ({ apiJson: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn() }))

const models = [{ id: 'asr-1', modelType: 'asr', runtimeStatus: 'available' }]
beforeEach(() => { jest.clearAllMocks(); jest.mocked(readAccountId).mockResolvedValue('account-default') })

test('concurrent callers share one request and subsequent calls use short-term cache', async () => {
  jest.mocked(readAccountId).mockResolvedValue('account-dedup')
  let finish!: (value: { data: typeof models }) => void
  jest.mocked(apiJson).mockImplementation(() => new Promise(resolve => { finish = resolve }) as never)
  const first = loadModels()
  const second = loadModels()
  await Promise.resolve(); await Promise.resolve()
  expect(apiJson).toHaveBeenCalledTimes(1)
  finish({ data: models })
  await expect(first).resolves.toEqual(models)
  await expect(second).resolves.toEqual(models)
  await expect(loadModels()).resolves.toEqual(models)
  expect(apiJson).toHaveBeenCalledTimes(1)
})

test('explicit refresh fetches new list and replaces cached model status', async () => {
  jest.mocked(readAccountId).mockResolvedValue('account-refresh')
  jest.mocked(apiJson).mockResolvedValueOnce({ data: models } as never)
    .mockResolvedValueOnce({ data: [{ ...models[0], runtimeStatus: 'unavailable' }] } as never)
  await loadModels()
  const refreshed = await loadModels(true)
  expect(refreshed[0].runtimeStatus).toBe('unavailable')
  expect((await loadModels())[0].runtimeStatus).toBe('unavailable')
  expect(apiJson).toHaveBeenCalledTimes(2)
})

test('account switch cannot reuse old data or cache a late reply into the new account', async () => {
  let account = 'account-old'
  jest.mocked(readAccountId).mockImplementation(async () => account)
  let finish!: (value: { data: typeof models }) => void
  jest.mocked(apiJson).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
    .mockResolvedValueOnce({ data: [{ id: 'llm-new', modelType: 'llm', runtimeStatus: 'available' }] } as never)
  const oldRequest = loadModels()
  await Promise.resolve(); await Promise.resolve()
  account = 'account-new'
  const fresh = await loadModels()
  expect(fresh[0].id).toBe('llm-new')
  finish({ data: models })
  await expect(oldRequest).rejects.toThrow('账号已切换')
  expect((await loadModels())[0].id).toBe('llm-new')
  expect(apiJson).toHaveBeenCalledTimes(2)
})

test('failed fetch is retried and never cached', async () => {
  jest.mocked(readAccountId).mockResolvedValue('account-error')
  jest.mocked(apiJson).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: models } as never)
  await expect(loadModels()).rejects.toThrow('network')
  await expect(loadModels()).resolves.toEqual(models)
  expect(apiJson).toHaveBeenCalledTimes(2)
})

test('expired model cache fetches again', async () => {
  jest.mocked(readAccountId).mockResolvedValue('account-expiry')
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    jest.mocked(apiJson).mockResolvedValueOnce({ data: models } as never)
      .mockResolvedValueOnce({ data: [{ ...models[0], runtimeStatus: 'unavailable' }] } as never)
    await loadModels()
    clock.mockReturnValue(62_000)
    expect((await loadModels())[0].runtimeStatus).toBe('unavailable')
    expect(apiJson).toHaveBeenCalledTimes(2)
  } finally { clock.mockRestore() }
})
