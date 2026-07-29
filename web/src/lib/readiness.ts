// ── Readiness score ──────────────────────────────────────────────────────────
// A transparent 0–100 heuristic from the signals the app already collects:
// daily wellness check-ins, strength-session RPE, Achilles pain logs, the
// week-over-week run load, and (once enough history exists) overnight
// physiology from the watch — sleep duration, resting HR and HRV against the
// athlete's own rolling baseline (see lib/physiology.ts). Every adjustment is
// returned as a reason so the UI can show WHY, not just a number. No medical
// language — advisory only. Physiology never replaces the check-in: it's
// folded in alongside it, and stays silent (not zero) until it has enough
// history to say anything real — see physiologyWarmup on the result.

import type { PhysiologyResult } from "./physiology";

export type ReadinessBand = "ready" | "easy" | "rest";

export interface ReadinessReason {
  label: string;
  delta: number;
}

export interface ReadinessInput {
  /** Most recent check-in within 48 h, if any */
  wellness: {
    ageHours: number;
    energy: number | null; // 1–5 (5 = great)
    sleepQuality: number | null; // 1–5
    soreness: number | null; // 1–5 (5 = very sore)
    illness: boolean;
    injury: boolean;
  } | null;
  /** Highest pain score (0–10) logged in the last 3 days, if any */
  maxRecentPain: number | null;
  /** Average RPE of strength sets logged in the last 36 h, if any */
  recentStrengthRpe: number | null;
  /** Highest run RPE (0–10) logged in the last 36 h, if any */
  recentRunRpe?: number | null;
  /** Completed run km in the last 7 days */
  last7DaysKm: number;
  /** Average weekly completed km over the 3 weeks before that */
  priorWeeklyAvgKm: number;
  /** Overnight physiology (sleep/RHR/HRV vs baseline), already computed by
   * lib/physiology.ts from the wellness_metrics history. Null when the
   * Garmin worker isn't configured or nothing has synced yet — distinct from
   * `ready: false`, which means "configured but still in warm-up". */
  physiology: PhysiologyResult | null;
}

export interface ReadinessResult {
  score: number; // 0–100
  band: ReadinessBand;
  reasons: ReadinessReason[];
  hasCheckIn: boolean;
  advice: string;
  /** Set while physiology data exists but hasn't cleared the baseline floor
   * yet, so the card can say "still building your baseline" instead of
   * silently omitting the signal. Null once ready, or if there's no
   * physiology data at all. */
  physiologyWarmup: { daysCollected: number; daysNeeded: number } | null;
  /** wellness_metrics.source the physiology signal (ready or warm-up) was
   * computed from, so the UI can name it (e.g. "Garmin"). Null when there's
   * no physiology data at all. See lib/wellness-source.ts. */
  physiologySource: string | null;
}

const BASE = 75;

function band(score: number): ReadinessBand {
  if (score >= 70) return "ready";
  if (score >= 45) return "easy";
  return "rest";
}

const ADVICE: Record<ReadinessBand, string> = {
  ready: "Green light. Train as planned.",
  easy: "Take today's paces 10–15 s/km easier, or trim a rep.",
  rest: "Recovery is part of the plan. Swap today for rest or a short easy run.",
};

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  let score = BASE;
  const reasons: ReadinessReason[] = [];
  const add = (label: string, delta: number) => {
    if (delta === 0) return;
    score += delta;
    reasons.push({ label, delta });
  };

  const w = input.wellness;
  if (w) {
    if (w.energy != null) {
      // 1..5 → -16, -8, 0, +5, +10
      add("Energy", [-16, -8, 0, 5, 10][Math.min(4, Math.max(0, w.energy - 1))]);
    }
    if (w.sleepQuality != null) {
      add("Sleep", [-14, -7, 0, 4, 8][Math.min(4, Math.max(0, w.sleepQuality - 1))]);
    }
    if (w.soreness != null) {
      // 1..5 → +4, 0, -6, -12, -18
      add("Soreness", [4, 0, -6, -12, -18][Math.min(4, Math.max(0, w.soreness - 1))]);
    }
  }

  if (input.maxRecentPain != null && input.maxRecentPain > 4) {
    add("Recent pain flag", -15);
  }

  if (input.recentStrengthRpe != null && input.recentStrengthRpe >= 8.5) {
    add("Hard strength session", -10);
  }

  if (input.recentRunRpe != null && input.recentRunRpe >= 8) {
    add("Hard run effort", -8);
  }

  if (
    input.priorWeeklyAvgKm > 5 &&
    input.last7DaysKm > input.priorWeeklyAvgKm * 1.3
  ) {
    add("Load spike vs recent weeks", -10);
  }

  // Physiology folds in alongside the check-in, not instead of it. During
  // warm-up (not enough baseline history) it contributes nothing — see the
  // module doc in physiology.ts for why a confident number from four days
  // of data would be worse than staying silent.
  if (input.physiology?.ready) {
    for (const r of input.physiology.reasons) add(r.label, r.delta);
  }

  // Hard caps — these override everything else.
  if (w?.illness) {
    score = Math.min(score, 25);
    reasons.push({ label: "Feeling ill", delta: 0 });
  }
  if (w?.injury) {
    score = Math.min(score, 35);
    reasons.push({ label: "Injury flagged", delta: 0 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const b = band(score);
  return {
    score,
    band: b,
    reasons,
    hasCheckIn: w != null && w.ageHours <= 30,
    advice: ADVICE[b],
    physiologyWarmup:
      input.physiology && !input.physiology.ready ? input.physiology.warmup : null,
    physiologySource: input.physiology?.source ?? null,
  };
}
