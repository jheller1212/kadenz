// Garmin workout-name labels. A watch shows a flat list of scheduled workouts,
// so a bare "Easy Run" or "Upper · Kraft" is ambiguous across weeks. Prefix the
// plan week and append the key metric so each reads clearly and is uniquely
// identifiable, e.g. "W3 · Easy Run 10km", "W3 · Upper · Kraft · 30 min".

/** 1-indexed plan week for a date, relative to the plan start (Monday-anchored
 *  weeks). Clamped to >= 1 so pre-start dates don't read as week 0/negative. */
export function planWeekNumber(date: Date, planStart: Date): number {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  return Math.max(1, Math.floor((date.getTime() - planStart.getTime()) / WEEK_MS) + 1);
}

/** Build the Garmin workout name from a base title, an optional week number and
 *  an optional trailing metric (distance for runs is already in the title, so
 *  it's mainly the duration for strength). */
export function garminLabel(
  baseTitle: string,
  opts: { weekNumber?: number | null; metric?: string | null } = {}
): string {
  const parts: string[] = [];
  if (opts.weekNumber != null) parts.push(`W${opts.weekNumber}`);
  parts.push(baseTitle);
  if (opts.metric) parts.push(opts.metric);
  return parts.join(" · ");
}

/** Workout overview: a plan/week header line, then the workout's own
 *  description. e.g. "Half Marathon Plan (Week 2/8)\n\nConversational pace…".
 *  The worker appends the [kadenz] ownership tag beneath. */
export function garminDescription(opts: {
  planName?: string | null;
  weekNumber?: number | null;
  totalWeeks?: number | null;
  body?: string | null;
}): string {
  const lines: string[] = [];
  if (opts.weekNumber != null) {
    const wk = opts.totalWeeks
      ? `Week ${opts.weekNumber}/${opts.totalWeeks}`
      : `Week ${opts.weekNumber}`;
    lines.push(opts.planName ? `${opts.planName} (${wk})` : wk);
  }
  const body = opts.body?.trim();
  if (body) {
    if (lines.length) lines.push("");
    lines.push(body);
  }
  return lines.join("\n");
}
