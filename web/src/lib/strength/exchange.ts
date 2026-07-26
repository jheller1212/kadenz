import { EXERCISES, EXERCISE_BY_SLUG } from "./program";
import type { Equipment } from "./types";

// ── Exchange candidates ───────────────────────────────────────────────────────
//
// The seeded catalogue's only clean grouping keys are `category` (upper /
// lower / achilles / full_body — a movement-pattern proxy) and `primaryMuscle`
// (a freeform string, not a taxonomy). Rather than invent a finer movement
// taxonomy that isn't in the data, alternatives prefer an exact primaryMuscle
// match within the same category, and fall back to "same category" (same
// broad movement pattern) when nothing else shares that muscle. Achilles-role
// exercises are never offered or replaced — that work is rehab, not filler.

export interface ExchangeCandidate {
  slug: string;
  name: string;
  reason: string;
}

/**
 * `equipment`: the athlete's available equipment (strengthPlanSettings). Pass
 * `null` when no plan settings are configured yet — unfiltered, since we have
 * no basis to exclude anything.
 */
export function findExchangeCandidates(
  currentSlug: string,
  otherSlugsInSession: string[],
  equipment: Equipment[] | null
): ExchangeCandidate[] {
  const current = EXERCISE_BY_SLUG[currentSlug];
  if (!current || current.achillesRole) return [];

  const exclude = new Set([currentSlug, ...otherSlugsInSession]);
  const fitsEquipment = (needs: Equipment[] | undefined) =>
    equipment == null || (needs ?? []).every((e) => equipment.includes(e));

  const eligible = EXERCISES.filter(
    (e) => !exclude.has(e.slug) && !e.achillesRole && e.category === current.category && fitsEquipment(e.equipment)
  );

  const sameMuscle = current.primaryMuscle
    ? eligible.filter((e) => e.primaryMuscle === current.primaryMuscle)
    : [];
  const pool = sameMuscle.length > 0 ? sameMuscle : eligible;

  return pool.map((e) => ({
    slug: e.slug,
    name: e.name,
    reason:
      current.primaryMuscle && e.primaryMuscle === current.primaryMuscle
        ? `Same ${e.primaryMuscle.toLowerCase()} focus · fits your equipment`
        : `Same ${e.category} movement pattern · fits your equipment`,
  }));
}
