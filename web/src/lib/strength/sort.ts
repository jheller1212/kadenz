// Sort modes for pre-workout exercise lists (session overview + custom
// workout builder). "custom" is the implicit manual order — dragging a card
// flips the mode back to custom; picking any other mode reorders the actual
// list once (same state/persistence as a manual drag).

export type ExerciseSortMode =
  | "custom"
  | "weight_desc"
  | "weight_asc"
  | "name"
  | "frequency";

export const SORT_OPTIONS: Array<{
  key: Exclude<ExerciseSortMode, "custom">;
  label: string;
}> = [
  { key: "weight_desc", label: "Weight ↓" },
  { key: "weight_asc", label: "Weight ↑" },
  { key: "name", label: "A–Z" },
  { key: "frequency", label: "Most done" },
];

export function sortExerciseList<T>(
  items: T[],
  mode: ExerciseSortMode,
  get: {
    name: (item: T) => string;
    /** Current/prefilled load; null = bodyweight (sorts last either way). */
    weightKg: (item: T) => number | null | undefined;
    timesPerformed?: (item: T) => number;
  }
): T[] {
  if (mode === "custom") return items;
  const next = [...items]; // Array.sort is stable — ties keep the current order
  switch (mode) {
    case "name":
      next.sort((a, b) => get.name(a).localeCompare(get.name(b)));
      break;
    case "weight_desc":
      next.sort((a, b) => (get.weightKg(b) ?? -Infinity) - (get.weightKg(a) ?? -Infinity));
      break;
    case "weight_asc":
      next.sort((a, b) => (get.weightKg(a) ?? Infinity) - (get.weightKg(b) ?? Infinity));
      break;
    case "frequency":
      next.sort((a, b) => (get.timesPerformed?.(b) ?? 0) - (get.timesPerformed?.(a) ?? 0));
      break;
  }
  return next;
}
