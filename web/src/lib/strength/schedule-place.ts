import type { StrengthSessionType } from "./types";
import { HARD_RUN_TYPES, hasAchillesBlock } from "./constraints";

// ── Coach-style weekly placement (pure, unit-tested) ─────────────────────────
// Places a week's strength sessions around the run schedule the way a coach
// would: heavy leg work never lands on or directly before a hard run, easy
// days absorb the lighter sessions, back-to-back strength days are avoided,
// and a slot is dropped entirely rather than break a hard rule.

export interface PlacementDay {
  /** Stable key for the calendar day (e.g. "2026-07-15"). */
  key: string;
  /** 0=Sun … 6=Sat, in the athlete's timezone. */
  dow: number;
  /** Run planned this day, if any (workout type). */
  runType: string | null;
  /** Run planned the following day, if any. */
  nextDayRunType: string | null;
  /** Day already holds a strength session (manual or auto). */
  taken: boolean;
}

export interface Placement {
  key: string;
  type: StrengthSessionType;
}

const LOWER_TYPES = new Set<StrengthSessionType>(["lower", "lower_achilles"]);

/** Heaviest first — heavy sessions get first pick of the good days. */
const PLACEMENT_WEIGHT: Record<StrengthSessionType, number> = {
  lower_achilles: 5,
  lower: 4,
  full_body: 3,
  upper_achilles: 2,
  achilles: 1.5,
  upper: 1,
};

/**
 * Genuine physiological conflict — never place here no matter what else is
 * available. Everything else (spacing, doubling with an easy run) is a
 * preference: it shapes *which* day wins, but on its own must never be able
 * to eliminate a session the athlete configured. Conflating the two was the
 * bug — a full week of back-to-back-avoidance penalties could out-vote a
 * session into oblivion even though nothing about the placement was actually
 * harmful.
 */
export function isHardVeto(day: PlacementDay, type: StrengthSessionType): boolean {
  const isLower = LOWER_TYPES.has(type);
  const hardToday = day.runType != null && HARD_RUN_TYPES.has(day.runType);
  const longToday = day.runType === "long";
  const hardTomorrow =
    day.nextDayRunType != null &&
    (HARD_RUN_TYPES.has(day.nextDayRunType) || day.nextDayRunType === "long");

  // Heavy legs on a hard/long run day, or the day before a hard/long run:
  // real pre-fatigue/interference risk, not just a bad fit.
  if ((hardToday || longToday) && isLower) return true;
  if (hardTomorrow && (isLower || hasAchillesBlock(type))) return true;

  // Race day and the day before it are off-limits for every session type —
  // in practice the whole race week already carries zero strength sessions
  // (see reconcile.weekBudgetFor); this guards the edge case where race day
  // falls on a Monday and "the day before" sits in the previous calendar
  // week.
  if (day.runType === "race" || day.nextDayRunType === "race") return true;

  return false;
}

export function scorePlacement(
  day: PlacementDay,
  type: StrengthSessionType,
  strengthDays: Set<string>,
  allDays: PlacementDay[],
  /**
   * How much slack the week has: candidate days minus sessions still to
   * place. When it's tight (0 or negative — a 5-day, 4-session week has no
   * fully-spaced solution) the back-to-back penalty is dulled so it can
   * still break ties between otherwise-equal days without being able to
   * force a session onto a harmful day or, pre-fix, off the calendar
   * entirely. With room to spare it applies at full strength.
   */
  slack = 2
): number {
  let score = 0;
  const isLower = LOWER_TYPES.has(type);
  const hardToday = day.runType != null && HARD_RUN_TYPES.has(day.runType);
  const longToday = day.runType === "long";
  const hardTomorrow =
    day.nextDayRunType != null &&
    (HARD_RUN_TYPES.has(day.nextDayRunType) || day.nextDayRunType === "long");

  // Same day as a hard/long run: heavy legs are a hard veto (see
  // isHardVeto); anything else is merely a poor fit.
  if (hardToday || longToday) score += isLower ? -100 : -30;
  // Day before a hard or long run: don't pre-fatigue the legs.
  if (hardTomorrow) score += isLower || hasAchillesBlock(type) ? -70 : -10;
  // Doubling with any run costs a little even when it's easy.
  if (day.runType != null && !hardToday && !longToday) score += isLower ? -20 : -8;
  // A true rest day is the best home for strength.
  if (day.runType == null) score += 15;

  // Avoid back-to-back strength days — a spacing preference, scaled by how
  // much room the week actually has to honor it.
  const adjacencyWeight = slack >= 2 ? 30 : slack === 1 ? 15 : 5;
  const idx = allDays.findIndex((d) => d.key === day.key);
  const prev = allDays[idx - 1];
  const next = allDays[idx + 1];
  if (prev && strengthDays.has(prev.key)) score -= adjacencyWeight;
  if (next && strengthDays.has(next.key)) score -= adjacencyWeight;

  return score;
}

/**
 * Assign the rotation's session types to the week's candidate days.
 * `days` must cover the week in order (including non-candidate days so
 * adjacency is visible); candidates are the untaken entries whose `dow` is
 * in `availableDows`.
 */
export function placeStrengthWeek(
  days: PlacementDay[],
  availableDows: number[],
  rotation: StrengthSessionType[]
): Placement[] {
  const placements: Placement[] = [];
  const strengthDays = new Set(days.filter((d) => d.taken).map((d) => d.key));

  const candidateDays = days.filter(
    (d) => !d.taken && availableDows.includes(d.dow)
  ).length;
  const slack = candidateDays - rotation.length;

  const types = [...rotation].sort(
    (a, b) => (PLACEMENT_WEIGHT[b] ?? 0) - (PLACEMENT_WEIGHT[a] ?? 0)
  );

  for (const type of types) {
    let best: { day: PlacementDay; score: number } | null = null;
    for (const day of days) {
      if (day.taken) continue;
      if (!availableDows.includes(day.dow)) continue;
      if (strengthDays.has(day.key)) continue;
      if (isHardVeto(day, type)) continue; // genuine conflict — never a candidate
      const score = scorePlacement(day, type, strengthDays, days, slack);
      if (!best || score > best.score) best = { day, score };
    }
    // No veto-free day left this week — a real shortfall, not a preference
    // fight. Skip the slot; the caller surfaces this via shortWeeks.
    if (!best) continue;
    placements.push({ key: best.day.key, type });
    strengthDays.add(best.day.key);
  }

  // Present in calendar order regardless of placement priority.
  return placements.sort((a, b) => (a.key < b.key ? -1 : 1));
}
