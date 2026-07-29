import { EXERCISES } from "@/lib/strength/program";

// Shared by the logged-sets list, the planned-exercise blocks, and the "not
// done" section on the session detail screen — one lookup so the muscle tag
// reads the same everywhere on that page.
export function muscleFor(slug: string | undefined): string | null {
  if (!slug) return null;
  return EXERCISES.find((e) => e.slug === slug)?.primaryMuscle ?? null;
}
