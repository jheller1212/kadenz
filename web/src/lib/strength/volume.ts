// ── Canonical session volume ─────────────────────────────────────────────────
// The one place that turns a set of logged sets into "how much weight was
// moved". Every screen that shows a volume number (session detail, the Kraft
// hub stat row, exercise history) goes through this — before this module
// existed, session detail summed raw weightKg × reps with no dumbbell scaling
// and let bodyweight sets contribute zero, while exercise history's
// computeSessionMetrics (pr.ts) correctly doubled two-dumbbell lifts and
// counted bodyweight reps. Same session, two different numbers depending
// which screen you tapped into.
//
// kg and reps are not the same unit. A session (or a trailing window across
// several sessions) that mixes a loaded exercise (dumbbell press) with a
// bodyweight one (push-ups) is reported as TWO numbers here, not folded into
// one blended total — a single sum would either overstate the kg figure with
// unitless reps or silently drop the bodyweight work, which is the exact bug
// this module replaces.

import { setVolumeKg, type PrSet, type ExerciseLoadProfile } from "./pr";
import { EXERCISE_BY_SLUG } from "./program";

export interface VolumeSet extends Pick<PrSet, "weightKg" | "reps"> {
  exerciseSlug: string;
  /** Undefined/null reads as working — same convention as strength_sets.kind. */
  kind?: "warmup" | "working" | null;
}

export interface SessionVolume {
  /** Total kg moved across working sets of loaded exercises, scaled for
   *  two-dumbbell lifts. Null when no loaded working sets were logged, so
   *  callers can hide the tile instead of showing a misleading "0 kg". */
  kg: number | null;
  /** Total reps across working sets of bodyweight exercises. Null when no
   *  bodyweight working sets were logged. */
  bodyweightReps: number | null;
}

/**
 * An exercise's load profile (bodyweight vs. loaded, dumbbell count) lives
 * only in the static catalogue (program.ts EXERCISE_BY_SLUG) — it's not
 * persisted per-row on strength_sets, so any volume calculation needs the
 * set's exercise slug to look it up. An unknown slug (shouldn't happen; every
 * logged set references a real catalogue exercise) reads as loaded/two-hand,
 * matching computeSessionMetrics's existing default for an unspecified
 * dumbbell count.
 */
export function profileForSlug(slug: string): ExerciseLoadProfile {
  const entry = EXERCISE_BY_SLUG[slug];
  return { bodyweight: entry?.startWeightKg == null, dumbbells: entry?.dumbbells };
}

/** Canonical volume for any list of logged sets — a whole session, or a
 *  trailing window across several sessions (see the Kraft hub summary
 *  route). Warm-up sets never count, same exclusion pr.ts's isWorkingSet
 *  already applies to PR detection. */
export function sessionVolume(sets: VolumeSet[]): SessionVolume {
  let kg = 0;
  let bodyweightReps = 0;
  let hasKg = false;
  let hasReps = false;

  for (const s of sets) {
    if (s.kind === "warmup") continue;
    const profile = profileForSlug(s.exerciseSlug);
    if (profile.bodyweight) {
      bodyweightReps += s.reps ?? 0;
      hasReps = true;
    } else {
      kg += setVolumeKg(s, profile);
      hasKg = true;
    }
  }

  return { kg: hasKg ? kg : null, bodyweightReps: hasReps ? bodyweightReps : null };
}
