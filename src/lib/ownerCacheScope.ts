import Storage from '@react-native-async-storage/async-storage'
import { assertIdentity, type IdentityScope } from './sessionGate'
type Proof = { version: 1; owner: string; authOrigin: string; integrationOrigin: string }
const key = (owner: string) => `vinote:${owner}:cache-scope`
export async function trustedLocalCache(scope: IdentityScope) {
  assertIdentity(scope)
  const value = await Storage.getItem(key(scope.owner)); assertIdentity(scope)
  if (!value) return false
  try {
    const proof = JSON.parse(value) as Proof
    return proof.version === 1 && proof.owner === scope.owner && proof.authOrigin === scope.authOrigin && proof.integrationOrigin === scope.integrationOrigin
  } catch { return false }
}
export async function rememberVerifiedCache(scope: IdentityScope) {
  assertIdentity(scope)
  const proof: Proof = { version: 1, owner: scope.owner, authOrigin: scope.authOrigin, integrationOrigin: scope.integrationOrigin }
  await Storage.setItem(key(scope.owner), JSON.stringify(proof)); assertIdentity(scope)
  // This proves account context only; never rewrite workspace.serviceOrigin.
}
