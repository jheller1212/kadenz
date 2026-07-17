/**
 * Compact "how long ago" label for last-effort displays, e.g. "Last: 12 kg × 10 · 3d ago".
 * Days up to 13, weeks up to 8 weeks, months beyond that.
 */
export function formatRecency(date: Date | string | number): string {
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days > 56) return `${Math.max(2, Math.round(days / 30))}mo ago`;
  if (days > 13) return `${Math.round(days / 7)}w ago`;
  return `${days}d ago`;
}
