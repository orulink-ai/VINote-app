import { useSyncExternalStore } from 'react'
import { gateSnapshot, subscribeGate } from './sessionGate'

export function useSessionGate() {
  return useSyncExternalStore(subscribeGate, gateSnapshot, gateSnapshot)
}
