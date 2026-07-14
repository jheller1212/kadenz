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

/** Below this score a slot is skipped — a missed session beats a bad one. */
const VETO_SCORE = -60;

export function scorePlacement(
  day: PlacementDay,
  type: StrengthSessionType,
  strengthDays: Set<string>,
  allDays: PlacementDay[]
): number {
  let score = 0;
  const isLower = LOWER_TYPES.has(type);
  const hardToday = day.runType != null && HARD_RUN_TYPES.has(day.runType);
  const longToday = day.runType === "long";
  const hardTomorrow =
    day.nextDayRunType != null &&
    (HARD_RUN_TYPES.has(day.nextDayRunType) || day.nextDayRunType === "long");

  // Same day as a hard/long run: heavy legs are out; anything else is poor.
  if (hardToday || longToday) score += isLower ? -100 : -30;
  // Day before a hard or long run: don't pre-fatigue the legs.
  if (hardTomorrow) score += isLower || hasAchillesBlock(type) ? -70 : -10;
  // Doubling with any run costs a little even when it's easy.
  if (day.runType != null && !hardToday && !longToday) score += isLower ? -20 : -8;
  // A true rest day is the best home for strength.
  if (day.runType == null) score += 15;

  // Avoid back-to-back strength days.
  const idx = allDays.findIndex((d) => d.key === day.key);
  const prev = allDays[idx - 1];
  const next = allDays[idx + 1];
  if (prev && strengthDays.has(prev.key)) score -= 30;
  if (next && strengthDays.has(next.key)) score -= 30;

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

  const types = [...rotation].sort(
    (a, b) => (PLACEMENT_WEIGHT[b] ?? 0) - (PLACEMENT_WEIGHT[a] ?? 0)
  );

  for (const type of types) {
    let best: { day: PlacementDay; score: number } | null = null;
    for (const day of days) {
      if (day.taken) continue;
      if (!availableDows.includes(day.dow)) continue;
      if (strengthDays.has(day.key)) continue;
      const score = scorePlacement(day, type, strengthDays, days);
      if (!best || score > best.score) best = { day, score };
    }
    if (!best || best.score <= VETO_SCORE) continue; // skip rather than harm
    placements.push({ key: best.day.key, type });
    strengthDays.add(best.day.key);
  }

  // Present in calendar order regardless of placement priority.
  return placements.sort((a, b) => (a.key < b.key ? -1 : 1));
}
