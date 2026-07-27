// Relative import, not "@/" — there is no vitest config in this repo, so the
// alias does not resolve under the test runner (see training/session.ts).
import { displayWeight, weightUnitLabel } from "../units";

// ── Weight ladder ─────────────────────────────────────────────────────────────
//
// Standard universal increments (hardware-agnostic): 0.5 kg steps up to 25 kg,
// then 1 kg steps up to 50 kg. Snapping, progression, and deload are all
// derived from this list — to change the scheme, replace it and nothing else
// needs to change.

function buildStandardLevels(): number[] {
  const levels: number[] = [];
  for (let kg = 1; kg <= 25; kg += 0.5) levels.push(Math.round(kg * 10) / 10);
  for (let kg = 26; kg <= 50; kg += 1) levels.push(kg);
  return levels;
}

export const DUMBBELL_LEVELS_KG: readonly number[] = buildStandardLevels();

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

/**
 * Step a weight one ladder level up or down — the ONE stepper for every +/-
 * weight control. Handles bodyweight: stepping up from 0 lands on the lowest
 * level, stepping down from the lowest level returns to 0 (bodyweight).
 */
export function stepWeight(kg: number | null | undefined, delta: 1 | -1): number {
  const cur = kg ?? 0;
  if (cur <= 0) return delta > 0 ? DUMBBELL_LEVELS_KG[MIN_LEVEL] : 0;
  if (delta < 0 && levelForWeight(cur) <= MIN_LEVEL) return 0;
  return delta > 0 ? nextWeight(cur) : prevWeight(cur);
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
  const hold = holdNote ?? (dumbbells === 1 ? "1 dumbbell" : "one per hand");
  const side = perSide ? " · each side" : "";
  const { value, label } = displayLoad(weightKg);
  return `${value} ${label} ${count} · ${hold}${side}`;
}

/** Compact count suffix for a weight stepper label, e.g. "kg × 2". */
export function loadUnitLabel(dumbbells?: 1 | 2): string {
  return `${displayLoad(1).label} × ${dumbbells === 1 ? 1 : 2}`;
}

/** Convert a stored kg load to the display unit from settings. Routed through
 *  lib/units.ts's loadSettings()-backed helpers so this agrees with every
 *  other weight display in the app by construction, not by coincidence. */
function displayLoad(kg: number): { value: number; label: "kg" | "lbs" } {
  const label = weightUnitLabel() === "lbs" ? "lbs" : "kg";
  return { value: displayWeight(kg), label };
}
