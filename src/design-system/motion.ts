import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** Starts conservatively; never animate before the system preference is known. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value) }).catch(() => {})
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => { active = false; listener.remove() }
  }, [])
  return reduced
}
