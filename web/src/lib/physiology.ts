// ── Physiological readiness signal ──────────────────────────────────────────
// Turns a history of nightly wellness_metrics rows (sleep, resting HR, HRV
// pulled from the Garmin watch) into a readiness adjustment.
//
// HRV and resting HR are meaningless in absolute terms — a single night is
// noise. They only mean something against the athlete's own rolling
// baseline: a 7-day recent average compared with a 30-60 day baseline is the
// conventional window (e.g. Garmin, Whoop, Oura all use some variant of
// this). This module owns that math and refuses to produce a confident
// adjustment until MIN_BASELINE_NIGHTS of history exists — same rule as
// "no check-in, no score" in readiness.ts: a confident-looking number from
// four days of data is worse than no number, because it looks like evidence
// when it's noise.

export interface WellnessNight {
  /** Calendar day of the overnight reading, YYYY-MM-DD. */
  date: string;
  sleepSeconds: number | null;
  restingHr: number | null;
  hrvLastNightAvg: number | null;
}

export interface PhysiologyReason {
  label: string;
  delta: number;
}

export interface PhysiologyResult {
  delta: number;
  reasons: PhysiologyReason[];
  /** False means the signal is deliberately withheld — not enough baseline
   * history to trust a deviation yet. See `warmup` for how far along. */
  ready: boolean;
  warmup: { daysCollected: number; daysNeeded: number } | null;
}

// How far back the baseline looks, and how much history it needs before a
// deviation is trusted. Three weeks is short of the 30-60 day baseline the
// literature uses, but this is a floor to leave warm-up, not the full
// window — the baseline keeps improving with more nights past that floor.
const BASELINE_WINDOW_DAYS = 60;
const RECENT_WINDOW_DAYS = 7;
export const MIN_BASELINE_NIGHTS = 21;

const SHORT_SLEEP_SECONDS = 6 * 3600;
const VERY_SHORT_SLEEP_SECONDS = 5 * 3600;

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Nights with a parseable date strictly before `asOf`, within the window. */
function windowed(nights: WellnessNight[], asOf: Date, windowDays: number): WellnessNight[] {
  const asOfMs = asOf.getTime();
  const cutoff = asOfMs - windowDays * 24 * 3600_000;
  return nights.filter((n) => {
    const t = Date.parse(n.date);
    return !Number.isNaN(t) && t >= cutoff && t < asOfMs;
  });
}

interface BaselineRecent {
  baseline: number | null;
  baselineCount: number;
  recent: number | null;
  recentCount: number;
}

function baselineAndRecent(
  nights: WellnessNight[],
  asOf: Date,
  pick: (n: WellnessNight) => number | null
): BaselineRecent {
  const baselineValues = windowed(nights, asOf, BASELINE_WINDOW_DAYS)
    .map(pick)
    .filter((v): v is number => v != null);
  const recentValues = windowed(nights, asOf, RECENT_WINDOW_DAYS)
    .map(pick)
    .filter((v): v is number => v != null);
  return {
    baseline: baselineValues.length ? mean(baselineValues) : null,
    baselineCount: baselineValues.length,
    recent: recentValues.length ? mean(recentValues) : null,
    recentCount: recentValues.length,
  };
}

function latestNight(nights: WellnessNight[], asOf: Date): WellnessNight | null {
  const past = nights.filter((n) => {
    const t = Date.parse(n.date);
    return !Number.isNaN(t) && t < asOf.getTime();
  });
  if (!past.length) return null;
  return past.reduce((best, n) => (Date.parse(n.date) > Date.parse(best.date) ? n : best));
}

/**
 * Pure function: nightly wellness history → readiness adjustment.
 * `asOf` defaults to now but is a parameter so this stays testable without
 * mocking the clock.
 */
export function computePhysiologyReadiness(
  nights: WellnessNight[],
  asOf: Date = new Date()
): PhysiologyResult {
  const hrv = baselineAndRecent(nights, asOf, (n) => n.hrvLastNightAvg);
  const rhr = baselineAndRecent(nights, asOf, (n) => n.restingHr);

  const hrvReady = hrv.baselineCount >= MIN_BASELINE_NIGHTS && hrv.recentCount > 0;
  const rhrReady = rhr.baselineCount >= MIN_BASELINE_NIGHTS && rhr.recentCount > 0;

  // Neither signal has enough baseline history — say so honestly instead of
  // silently returning a zero delta that looks the same as "checked, normal".
  if (!hrvReady && !rhrReady) {
    return {
      delta: 0,
      reasons: [],
      ready: false,
      warmup: {
        daysCollected: Math.max(hrv.baselineCount, rhr.baselineCount),
        daysNeeded: MIN_BASELINE_NIGHTS,
      },
    };
  }

  const reasons: PhysiologyReason[] = [];
  let delta = 0;

  if (hrvReady && hrv.baseline != null && hrv.recent != null) {
    const pctDelta = ((hrv.recent - hrv.baseline) / hrv.baseline) * 100;
    if (pctDelta <= -15) {
      delta -= 12;
      reasons.push({ label: `HRV ${Math.round(Math.abs(pctDelta))}% below your baseline`, delta: -12 });
    } else if (pctDelta <= -8) {
      delta -= 6;
      reasons.push({ label: `HRV ${Math.round(Math.abs(pctDelta))}% below your baseline`, delta: -6 });
    } else if (pctDelta >= 15) {
      delta += 4;
      reasons.push({ label: `HRV ${Math.round(pctDelta)}% above your baseline`, delta: 4 });
    }
  }

  if (rhrReady && rhr.baseline != null && rhr.recent != null) {
    const bpmDelta = rhr.recent - rhr.baseline;
    if (bpmDelta >= 7) {
      delta -= 14;
      reasons.push({ label: `Resting HR ${Math.round(bpmDelta)} bpm above your baseline`, delta: -14 });
    } else if (bpmDelta >= 4) {
      delta -= 8;
      reasons.push({ label: `Resting HR ${Math.round(bpmDelta)} bpm above your baseline`, delta: -8 });
    }
  }

  // Sleep DURATION (device) is independent of the check-in's sleep QUALITY
  // question — an absolute threshold, not baseline-relative, since "how
  // many hours" doesn't need a personal baseline to be actionable.
  const last = latestNight(nights, asOf);
  if (last?.sleepSeconds != null) {
    const hours = last.sleepSeconds / 3600;
    if (last.sleepSeconds < VERY_SHORT_SLEEP_SECONDS) {
      delta -= 10;
      reasons.push({ label: `Short sleep (${hours.toFixed(1)}h)`, delta: -10 });
    } else if (last.sleepSeconds < SHORT_SLEEP_SECONDS) {
      delta -= 5;
      reasons.push({ label: `Short sleep (${hours.toFixed(1)}h)`, delta: -5 });
    }
  }

  return { delta, reasons, ready: true, warmup: null };
}
