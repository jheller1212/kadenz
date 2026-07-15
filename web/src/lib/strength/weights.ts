// ── Dumbbell weight ladder ────────────────────────────────────────────────────
//
// Loads snap to the discrete stops of the athlete's adjustable dumbbells.
// These are the real levels of the DH FitLife 18-in-1 (18 weight levels per
// dumbbell, confirmed from the product), which the handoff's "18 levels" note
// referred to. The steps are non-uniform, so "+1 level" varies in kg. Snapping,
// progression, and deload are all derived from this list — to change hardware,
// replace it with the new stops and nothing else needs to change.

export const DUMBBELL_LEVELS_KG: readonly number[] = [
  2.5, 4, 5, 6.5, 8, 9, 10.5, 12, 13, 14.5, 16, 17, 18, 19.5, 21, 22, 23, 23.5,
] as const;

export const MIN_LEVEL = 0;
export const MAX_LEVEL = DUMBBELL_LEVELS_KG.length - 1;

/** Weight (kg) at a given 0-based level, clamped to the ladder. */
export function weightForLevel(level: number): number {
  const clamped = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
  return DUMBBELL_LEVELS_KG[clamped];
}

/**
 * Level whose weight is closest to `kg`. Ties round down (the lighter level),
 * which is the safe default for load selection.
 */
export function levelForWeight(kg: number): number {
  let best = MIN_LEVEL;
  let bestDist = Infinity;
  for (let i = 0; i < DUMBBELL_LEVELS_KG.length; i++) {
    const dist = Math.abs(DUMBBELL_LEVELS_KG[i] - kg);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Snap an arbitrary kg value onto the nearest valid dumbbell weight. */
export function snapToLevel(kg: number): number {
  return weightForLevel(levelForWeight(kg));
}

/** The next heavier weight, or the same weight if already at the top. */
export function nextWeight(kg: number): number {
  return weightForLevel(levelForWeight(kg) + 1);
}

/** The next lighter weight, or the same weight if already at the bottom. */
export function prevWeight(kg: number): number {
  return weightForLevel(levelForWeight(kg) - 1);
}

/** True when a load sits at the heaviest available dumbbell level. */
export function isTopLevel(kg: number): boolean {
  return levelForWeight(kg) >= MAX_LEVEL;
}

// ── Load descriptor ───────────────────────────────────────────────────────────
// One consistent way to answer "how many dumbbells and how heavy" across every
// screen, so the athlete never has to guess whether a weight is per-hand or
// total, or whether a single-leg lift uses one dumbbell or two.

export interface LoadStyle {
  /** Dumbbells used (1 or 2). Omit for a standard pair on a dumbbell lift. */
  dumbbells?: 1 | 2;
  /** How the load is held, e.g. "opposite hand", "goblet", "on hips". */
  holdNote?: string;
  /** Worked one side / leg at a time. */
  perSide?: boolean;
}

/**
 * Full, unambiguous load line, e.g.
 *   "7.5 kg × 2 · one per hand · each leg"
 *   "15 kg × 1 · opposite hand"
 * Weight is always per dumbbell. Bodyweight when the load is null/0.
 */
export function formatLoad(
  weightKg: number | null | undefined,
  style: LoadStyle = {}
): string {
  const { dumbbells, holdNote, perSide } = style;
  if (weightKg == null || weightKg <= 0) {
    return perSide ? "Bodyweight · each side" : "Bodyweight";
  }
  const count = dumbbells === 1 ? "× 1" : "× 2";
  const hold = holdNote ?? (dumbbells === 1 ? "single dumbbell" : "one per hand");
  const side = perSide ? " · each side" : "";
  return `${weightKg} kg ${count} · ${hold}${side}`;
}

/** Compact count suffix for a weight stepper label, e.g. "kg × 2". */
export function loadUnitLabel(dumbbells?: 1 | 2): string {
  return `kg × ${dumbbells === 1 ? 1 : 2}`;
}
