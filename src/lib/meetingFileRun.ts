import { advanceMeetingFile, type MeetingFileBinding, type MeetingFileCheckpoint } from './meetingFileWorkflow'
import type { MeetingJobPhase } from './meetingFileJobState'

type Operations = Parameters<typeof advanceMeetingFile>[2] & {
  wait: () => Promise<void>
  progress: (phase: MeetingJobPhase) => void
}

/** Poll the persisted job; transport errors propagate and never cause another upload. */
export async function runMeetingFile(initial: MeetingFileCheckpoint, binding: MeetingFileBinding, ops: Operations): Promise<MeetingFileCheckpoint> {
  let checkpoint = initial
  for (;;) {
    await ops.guard()
    if (!['created', 'submitted', 'result', 'failed', 'unknown'].includes(checkpoint.job.phase)) throw new Error('会议转写任务状态无效')
    if (checkpoint.job.phase === 'failed' || checkpoint.job.phase === 'unknown') return checkpoint
    if (checkpoint.job.phase === 'submitted') {
      ops.progress('submitted')
      await ops.wait()
      await ops.guard()
    }
    checkpoint = await advanceMeetingFile(checkpoint, binding, ops)
    if (checkpoint.result) { ops.progress('result'); return checkpoint }
  }
}
