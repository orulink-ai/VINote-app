/** Service-reported submission position and durable final coverage are independent. */
export type AsrProgress = { duration: number; submittedSeconds: number; confirmedSeconds: number }
export function validAsrProgress(value: AsrProgress | undefined): boolean {
  return !!value && Number.isFinite(value.duration) && value.duration > 0 &&
    Number.isFinite(value.submittedSeconds) && value.submittedSeconds >= 0 && value.submittedSeconds <= value.duration &&
    Number.isFinite(value.confirmedSeconds) && value.confirmedSeconds >= 0 && value.confirmedSeconds <= value.duration
}
export function submissionPercent(value: AsrProgress | undefined): number | undefined {
  // Submission reaching the end never confirms the provider final or its save.
  return validAsrProgress(value) ? Math.min(99, Math.floor(value!.submittedSeconds / value!.duration * 100)) : undefined
}
