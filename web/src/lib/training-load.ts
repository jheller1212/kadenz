// ── Training load: session-RPE method (Foster et al., 1998) ─────────────────
// load (AU) = session RPE (Borg CR-10, 0-10) x session duration in minutes.
// This is the same "load" as internal-load research (Foster, "Monitoring
// training in athletes with reference to overtraining syndrome", Med Sci
// Sports Exerc, 1998) and the sRPE method used by TrainingPeaks and most
// applied sport-science practice. It is picked over an HR-based TRIMP because
// it needs no continuous HR stream (strength sessions rarely have one) and
// it reuses signals the app already asks the athlete for: post-session RPE
// (workouts.rpe for runs, strength_sets.rpe for lifts) and real recorded
// duration. No new input, no bespoke formula.
//
// A session missing either input (no RPE logged, or no real duration) gets
// NO load rather than a fabricated one — see runSessionLoad / strengthSessionLoad.
// A trend built from a mix of real and invented numbers would be worse than
// one with visible gaps, because the athlete cannot tell the two apart.

export interface WorkingSetRpe {
  rpe: number | null | undefined;
  /** "warmup" | "working" | null/undefined. Matches strength_sets.kind —
   *  warm-ups never count toward RPE the same way they never count toward
   *  volume (see lib/strength/volume.ts). */
  kind?: string | null;
}

/** Session-RPE load for a single run: RPE x duration in minutes. Null when
 *  either the RPE or the recorded duration is missing. */
export function runSessionLoad(
  rpe: number | null | undefined,
  durationSeconds: number | null | undefined
): number | null {
  if (rpe == null || rpe <= 0) return null;
  if (durationSeconds == null || durationSeconds <= 0) return null;
  return rpe * (durationSeconds / 60);
}

/** Average RPE across a strength session's working sets (warm-ups excluded,
 *  same convention as lib/strength/volume.ts). Null when no working set
 *  carries an RPE. */
export function averageWorkingRpe(sets: WorkingSetRpe[]): number | null {
  const vals = sets
    .filter((s) => s.kind !== "warmup")
    .map((s) => s.rpe)
    .filter((v): v is number => v != null && v > 0);
  if (vals.length === 0) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

/** Session-RPE load for a strength session: average working-set RPE x
 *  session duration in minutes. Null when either is missing — a session with
 *  no logged RPE, or no real start/end (never started, still open), has no
 *  load rather than a zero or default one. */
export function strengthSessionLoad(
  sets: WorkingSetRpe[],
  durationSeconds: number | null | undefined
): number | null {
  const avgRpe = averageWorkingRpe(sets);
  if (avgRpe == null) return null;
  if (durationSeconds == null || durationSeconds <= 0) return null;
  return avgRpe * (durationSeconds / 60);
}

export interface LoadEntry {
  date: Date;
  load: number;
}

export interface WeeklyLoad {
  /** Monday of the ISO week, local date, "YYYY-MM-DD". */
  weekStart: string;
  load: number;
  sessions: number;
}

/** Monday-anchored ISO week start for a date, as a local YYYY-MM-DD string. */
function weekStartKey(d: Date): string {
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Sums load per calendar week (Monday start) over `weeks` trailing weeks
 * ending on `now`'s week, oldest first. Entries outside the window, and
 * entries a caller never produced a load for in the first place (they are
 * simply absent from `entries` — see runSessionLoad/strengthSessionLoad),
 * are never averaged in: a week with no qualifying session is 0 load from
 * 0 sessions, not an average diluted by silence.
 */
export function weeklyLoadTrend(
  entries: LoadEntry[],
  weeks: number,
  now: Date = new Date()
): WeeklyLoad[] {
  const buckets = new Map<string, WeeklyLoad>();
  const order: string[] = [];
  const cursor = new Date(now);
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i * 7);
    const key = weekStartKey(d);
    if (!buckets.has(key)) {
      buckets.set(key, { weekStart: key, load: 0, sessions: 0 });
      order.push(key);
    }
  }

  for (const e of entries) {
    const key = weekStartKey(e.date);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the requested window
    bucket.load += e.load;
    bucket.sessions += 1;
  }

  return order.map((k) => buckets.get(k)!);
}
