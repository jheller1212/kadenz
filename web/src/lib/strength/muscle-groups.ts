// Groups the raw `primaryMuscle` / `secondaryMuscles` strings from
// program.ts into a small set of athlete-legible filter chips for the custom
// workout picker. Athletes think "back" or "biceps", not "rotator cuff" vs
// "rear delts" vs "front delts" — but we still key off the *raw* values so a
// chip filter and any future muscle-based feature share this single mapping
// instead of re-deriving groups inline and drifting apart.
//
// Groups were sized off the actual catalogue (measured on program.ts, 88
// exercises with a primaryMuscle): every group below clears at least 5
// members once secondaryMuscles are counted in. Two groups that clear on
// primaryMuscle alone (Biceps, Triceps) were *only* reachable through
// secondaryMuscles before program.ts's "Arms" primaryMuscle values were
// split into Biceps/Triceps — see the primaryMuscle: "Biceps"/"Triceps"
// edits in program.ts. That split, plus deliberately absorbing several
// single/double-digit raw muscles into a bigger neighbour, is why the filter
// must match secondaryMuscles too (see exercise-search.ts) — a Biceps or
// Triceps chip would otherwise return nothing for exercises where that
// muscle is only ever secondary.
//
// This map is total over every raw value seen in program.ts today, except
// "Knee stability" (not a muscle — deliberately left unmapped; an exercise
// with that as a *secondary* value still surfaces fine via its
// primaryMuscle). A new exercise added with an unrecognised primaryMuscle
// falls into "Other" (see muscleGroupFor) rather than silently vanishing
// from every group filter.
export const MUSCLE_GROUPS = [
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves and shins",
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Core",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number] | "Other";

// Raw muscle string (from either primaryMuscle or secondaryMuscles) -> group.
// Grouping rationale:
// - Glutes absorbs Adductors/"Inner thighs" and "Hip abductors"/"Hip
//   external rotators": all deep hip work, 2 exercises each, too small to
//   stand alone as chips.
// - Calves and shins absorbs Calves, "Calves & Achilles", "Shin (tibialis
//   anterior)" and "Feet" — all lower-leg/foot work, typically prehab or
//   end-of-session isolation.
// - Back folds in "Upper back", "Lower back" and "Traps" — still reads as
//   "back" to the athlete picking from a list.
// - Shoulders folds in "Front delts", "Rear delts" and "Rotator cuff".
// - Biceps folds in "Forearms"/"Grip" — always trained alongside curls here.
const RAW_TO_GROUP: Record<string, MuscleGroup> = {
  Quads: "Quads",
  Hamstrings: "Hamstrings",
  Glutes: "Glutes",
  Adductors: "Glutes",
  "Inner thighs": "Glutes",
  "Hip abductors": "Glutes",
  "Hip external rotators": "Glutes",
  Calves: "Calves and shins",
  "Calves & Achilles": "Calves and shins",
  "Shin (tibialis anterior)": "Calves and shins",
  Feet: "Calves and shins",
  Chest: "Chest",
  Back: "Back",
  "Upper back": "Back",
  "Lower back": "Back",
  Traps: "Back",
  Shoulders: "Shoulders",
  "Front delts": "Shoulders",
  "Rear delts": "Shoulders",
  "Rotator cuff": "Shoulders",
  Biceps: "Biceps",
  Forearms: "Biceps",
  Grip: "Biceps",
  Triceps: "Triceps",
  Core: "Core",
  // "Knee stability" intentionally absent — not a muscle, left unmapped.
};

/** Maps a raw muscle string (or undefined) to a filter group. Total: never returns undefined. */
export function muscleGroupFor(muscle: string | undefined): MuscleGroup {
  if (!muscle) return "Other";
  return RAW_TO_GROUP[muscle] ?? "Other";
}
