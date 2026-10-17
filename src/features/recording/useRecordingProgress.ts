import { useEffect, useState, useSyncExternalStore } from 'react'
import { readAccountId } from '../../lib/storage'
import { getGenerationProgress, subscribeGenerationProgress } from './recordingProcessing'

/** Progress follows the recording across screens, including recovered jobs. */
export function useRecordingProgress() {
  const progress = useSyncExternalStore(subscribeGenerationProgress, getGenerationProgress)
  const [owner, setOwner] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void readAccountId().then(value => { if (active) setOwner(value) }).catch(() => { if (active) setOwner(null) })
    return () => { active = false }
  }, [progress?.owner])
  return owner && progress?.owner === owner ? progress : null
}
