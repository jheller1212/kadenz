/**
 * Statuses worth retrying later rather than surfacing as a hard failure.
 * Kept dependency-free so both the offline queue and its tests can use it.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
