// Pure search + group filtering for the "add exercise" picker (88 exercises,
// no debounce needed at that size). Kept out of the component so it's unit
// testable without rendering anything.

// Relative imports, not "@/" — there is no vitest config in this repo, so
// the alias does not resolve under the test runner (see strength/weights.ts).
import type { ExerciseDef } from "./types";
import { muscleGroupFor, type MuscleGroup } from "./muscle-groups";

export interface ExercisePickerFilter {
  /** Free-text query; trimmed and case-folded before matching. */
  query: string;
  /** null = every group. */
  group: MuscleGroup | null;
}

// Text-match strength, best first. A name match always outranks an
// equipment/muscle match, however weak, so the obvious result never gets
// buried under a pile of exercises that merely mention the query as their
// equipment or muscle. isolatedModules forbids `const enum`, so this is a
// plain numeric union.
type NameRank = 0 | 1 | 2 | 3;
const RANK_NAME_EXACT: NameRank = 0;
const RANK_NAME_STARTS: NameRank = 1;
const RANK_NAME_INCLUDES: NameRank = 2;
const RANK_OTHER: NameRank = 3;

// Group-match strength: a primaryMuscle match ranks above a secondary-only
// match, e.g. a Biceps filter shows curls (primary) before curl_to_press
// (Biceps primary but Triceps only via secondary, so it ranks lower in a
// Triceps filter than the dedicated triceps moves).
type GroupRank = 0 | 1;
const RANK_GROUP_PRIMARY: GroupRank = 0;
const RANK_GROUP_SECONDARY: GroupRank = 1;

function fold(s: string): string {
  return s.trim().toLowerCase();
}

/** Returns the best text-match rank for a query against one exercise, or null if it doesn't match at all. */
function rankNameMatch(ex: ExerciseDef, query: string): NameRank | null {
  const name = fold(ex.name);
  if (name === query) return RANK_NAME_EXACT;
  if (name.startsWith(query)) return RANK_NAME_STARTS;
  if (name.includes(query)) return RANK_NAME_INCLUDES;

  const other = [ex.primaryMuscle, ...(ex.secondaryMuscles ?? []), ...(ex.equipment ?? [])]
    .filter((v): v is string => Boolean(v))
    .map(fold);
  if (other.some((v) => v.includes(query))) return RANK_OTHER;

  return null;
}

/**
 * Best group-match rank for one exercise against a group, or null if the
 * exercise belongs to neither its primary nor any secondary muscle in that
 * group. Matches secondaryMuscles too — several groups (Biceps, Triceps)
 * only exist as secondary values on some exercises in the catalogue, so a
 * primary-only match would return nothing for those chips.
 */
function rankGroupMatch(ex: ExerciseDef, group: MuscleGroup): GroupRank | null {
  if (muscleGroupFor(ex.primaryMuscle) === group) return RANK_GROUP_PRIMARY;
  const secondaryHit = (ex.secondaryMuscles ?? []).some((m) => muscleGroupFor(m) === group);
  return secondaryHit ? RANK_GROUP_SECONDARY : null;
}

/** True if the exercise matches the given group via primaryMuscle or secondaryMuscles (null group = always true). */
export function matchesGroup(ex: ExerciseDef, group: MuscleGroup | null): boolean {
  if (group === null) return true;
  return rankGroupMatch(ex, group) !== null;
}

/**
 * Filters + ranks exercises for the picker. Sorted by (name-match rank,
 * group-match rank): a query's name match always wins first, then within
 * equal name rank a primary muscle match outranks a secondary-only one.
 * Empty query + no group keeps the incoming order (the picker's own
 * muscle-order grouping happens outside this function).
 */
export function filterExercises(exercises: ExerciseDef[], filter: ExercisePickerFilter): ExerciseDef[] {
  const query = fold(filter.query);
  const group = filter.group;

  const ranked: Array<{ ex: ExerciseDef; nameRank: NameRank; groupRank: GroupRank }> = [];
  for (const ex of exercises) {
    const groupRank = group === null ? RANK_GROUP_PRIMARY : rankGroupMatch(ex, group);
    if (groupRank === null) continue;
    const nameRank = query ? rankNameMatch(ex, query) : RANK_NAME_EXACT;
    if (nameRank === null) continue;
    ranked.push({ ex, nameRank, groupRank });
  }
  if (!query && group === null) return ranked.map((r) => r.ex);

  // Stable sort: ties keep the incoming order.
  ranked.sort((a, b) => a.nameRank - b.nameRank || a.groupRank - b.groupRank);
  return ranked.map((r) => r.ex);
}
