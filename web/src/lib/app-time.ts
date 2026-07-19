// One definition of "today" for the whole app.
//
// Server code runs in UTC on Vercel, so `new Date().getDay()` disagrees with
// the athlete's calendar between midnight and 02:00 CEST — the Today screen
// showed yesterday's workout in that window. Everything date-shaped should go
// through here instead of using local getters.

export const APP_TZ = "Europe/Amsterdam";

/** Calendar day in the app's timezone, as YYYY-MM-DD. */
export function localDayKey(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

/** Day of week in the app's timezone (0=Sun … 6=Sat). */
export function localDow(d: Date = new Date()): number {
  const key = localDayKey(d);
  // Noon UTC: the same calendar day in UTC and in any European timezone, so
  // the weekday can't slip across a DST boundary.
  return new Date(`${key}T12:00:00.000Z`).getUTCDay();
}

/** Monday-based index of the day within its local week (Mon=0 … Sun=6). */
export function localWeekdayIndex(d: Date = new Date()): number {
  return (localDow(d) + 6) % 7;
}

/**
 * UTC instants that bracket the athlete's local Mon–Sun week. Generous by a
 * few hours at each end so stored noon-UTC workout dates always fall inside.
 */
export function localWeekRange(d: Date = new Date()): { weekStart: Date; weekEnd: Date } {
  const key = localDayKey(d);
  const noon = new Date(`${key}T12:00:00.000Z`);
  const monday = new Date(noon);
  monday.setUTCDate(monday.getUTCDate() - localWeekdayIndex(d));

  const weekStart = new Date(monday);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(monday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

/** True when both instants fall on the same calendar day for the athlete. */
export function isSameLocalDay(a: Date, b: Date = new Date()): boolean {
  return localDayKey(a) === localDayKey(b);
}
