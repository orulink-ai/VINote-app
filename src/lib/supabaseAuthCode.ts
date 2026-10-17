// Fixed public GoTrue categories only. Never derive a code from error messages.
const publicCodes = new Set([
  'bad_jwt', 'session_expired', 'session_not_found', 'no_authorization',
  'refresh_token_not_found', 'refresh_token_already_used', 'user_banned',
  'user_not_found', 'email_not_confirmed', 'unexpected_audience',
  'insufficient_aal', 'not_admin', 'access_denied', 'over_request_rate_limit',
  'over_email_send_rate_limit', 'provider_disabled', 'signup_disabled',
])
export function safeSupabaseAuthCode(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'missing'
  return typeof value === 'string' && publicCodes.has(value) ? value : 'unrecognized'
}

// These exact server codes describe a missing/expired session, not a generic
// invalid JWT, permissions failure, provider outage or HTTP status alone.
export function isMissingAuthSessionCode(value: unknown): boolean {
  return value === 'session_expired' || value === 'session_not_found'
}
// Only a /user access-token rejection can use bad_jwt to request one refresh.
// It is not evidence that the refresh token itself has expired.
export function isRejectedUserAccessCode(value: unknown): boolean {
  return isMissingAuthSessionCode(value) || value === 'bad_jwt'
}
export function isInvalidRefreshSessionCode(value: unknown): boolean {
  return isMissingAuthSessionCode(value) || value === 'refresh_token_not_found' || value === 'refresh_token_already_used'
}
// Preserve the original ApiError instance/status/details on an ambiguous
// refresh rejection. The verifier must not mistake that phase's raw 401 for a
// definitive rejection of the freshly checked user session. No credentials or
// bodies are cached; the weak marker lasts only as long as the thrown error.
const unclassifiedRefreshErrors = new WeakSet<object>()
export function markUnclassifiedRefreshError(error: object) { unclassifiedRefreshErrors.add(error) }
export function isUnclassifiedRefreshError(error: object) { return unclassifiedRefreshErrors.has(error) }
