import { integrationBaseUrl } from './integration'
import { identityEpoch } from './sessionIdentity'

/** Runtime-only proof. Persisted flags and reconstructed errors cannot mint it. */
export type FeishuPublishAttempt = Readonly<{ token: symbol }>
type AttemptState = { owner: string; operation: string; origin: string; epoch: number; payload: string; used: boolean; handedToHttp: boolean }
const attempts = new WeakMap<FeishuPublishAttempt, AttemptState>()
const failures = new WeakMap<object, FeishuPublishAttempt>()
export function createFeishuPublishAttempt(owner: string, operation: string, payload: unknown): FeishuPublishAttempt {
  const attempt = Object.freeze({ token: Symbol('feishu-publish-attempt') })
  attempts.set(attempt, { owner, operation, origin: integrationBaseUrl, epoch: identityEpoch(), payload: JSON.stringify(payload), used: false, handedToHttp: false })
  return attempt
}
export async function dispatchFeishuPublish<T>(attempt: FeishuPublishAttempt | undefined, owner: string, operation: string,
  payload: unknown, preflight: () => Promise<void>, dispatch: () => Promise<T>): Promise<T> {
  const state = attempt && attempts.get(attempt)
  if (attempt && (!state || state.used || state.owner !== owner || state.operation !== operation ||
      state.origin !== integrationBaseUrl || state.epoch !== identityEpoch() || state.payload !== JSON.stringify(payload))) throw new Error('发布 attempt 与当前确认不一致')
  if (state) state.used = true
  try { await preflight() }
  catch (error) {
    if (attempt && error && typeof error === 'object') failures.set(error, attempt)
    throw error
  }
  // From this point all failures are conservatively unknown, including token or HTTP failures.
  if (state) state.handedToHttp = true
  return dispatch()
}
export function provedNotDispatched(error: unknown, attempt: FeishuPublishAttempt, owner: string, operation: string) {
  const state = attempts.get(attempt)
  return !!state && state.used && !state.handedToHttp && state.owner === owner && state.operation === operation &&
    state.origin === integrationBaseUrl && state.epoch === identityEpoch() && !!error && typeof error === 'object' && failures.get(error) === attempt
}
