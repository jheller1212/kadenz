// Pure day-picking helper for the weekly scheduler (client/test safe).

/** Pick `n` days from the available set, spread as evenly as possible. */
export function pickSpreadDays(available: number[], n: number): number[] {
  const days = [...new Set(available)].sort((a, b) => a - b);
  if (days.length <= n) return days;
  const picked: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (days.length - 1)) / Math.max(1, n - 1));
    if (!picked.includes(days[idx])) picked.push(days[idx]);
  }
  // Rounding collisions: top up with the first unused days.
  for (const d of days) {
    if (picked.length >= n) break;
    if (!picked.includes(d)) picked.push(d);
  }
  return picked.sort((a, b) => a - b);
}
