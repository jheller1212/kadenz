// ── Per-set heart rate alignment (pure) ──────────────────────────────────────
// Aligns a linked activity's heart-rate stream against strength_sets.createdAt
// to estimate the heart rate during each logged set. No DB imports — same
// "pure selection, DB-agnostic" pattern as strength-match.ts / workout-match.ts.
//
// HONESTY CONSTRAINT: strength_sets.createdAt is when the set was LOGGED
// (the athlete tapped to save it), which approximates when it ENDED, not when
// it started — there's real lag between racking the weight and tapping the
// screen that this cannot see or correct for. The number this produces is
// "average/max heart rate over a guessed window ending around when the set
// was logged", not an exact per-rep reading. Say that in the UI, don't just
// show a bare number.
//
// The window itself:
//  - When strength_sets.duration_seconds ("time under load") is present, the
//    window is [createdAt - durationSeconds, createdAt] — the best guess of
//    the set's actual span.
//  - When it's absent (older rows, or a rest/no-duration entry), a fixed
//    FALLBACK_WINDOW_SEC before createdAt is used instead — a rougher
//    approximation, since there's no real duration to anchor on.
//
// If the activity has no heart-rate stream at all, or no stream samples fall
// inside a set's window (logged well outside the activity's recorded time
// range, for instance), the result is null for that set — never 0, never an
// interpolated guess.

const FALLBACK_WINDOW_SEC = 30;

export interface HeartRateStream {
  /** Seconds elapsed since the activity's startDate, one per sample. */
  time: number[];
  /** bpm, same length/index alignment as `time`. */
  heartrate: number[];
}

export interface SetForAlignment {
  createdAt: Date;
  /** strength_sets.duration_seconds — time under load for the set, or null. */
  durationSeconds: number | null;
}

export interface SetHeartRate {
  avgHr: number | null;
  maxHr: number | null;
}

const NO_HR: SetHeartRate = { avgHr: null, maxHr: null };

export function alignSetHeartRate(
  activityStart: Date,
  stream: HeartRateStream | null | undefined,
  set: SetForAlignment
): SetHeartRate {
  if (!stream || stream.heartrate.length === 0 || stream.time.length === 0) {
    return NO_HR;
  }

  const endSec = (set.createdAt.getTime() - activityStart.getTime()) / 1000;
  const windowSec =
    set.durationSeconds != null && set.durationSeconds > 0
      ? set.durationSeconds
      : FALLBACK_WINDOW_SEC;
  const startSec = endSec - windowSec;

  const samples: number[] = [];
  const n = Math.min(stream.time.length, stream.heartrate.length);
  for (let i = 0; i < n; i++) {
    const t = stream.time[i];
    if (t >= startSec && t <= endSec) {
      const hr = stream.heartrate[i];
      if (hr != null) samples.push(hr);
    }
  }

  if (samples.length === 0) return NO_HR;
  const avgHr = Math.round(samples.reduce((sum, v) => sum + v, 0) / samples.length);
  const maxHr = Math.round(Math.max(...samples));
  return { avgHr, maxHr };
}
