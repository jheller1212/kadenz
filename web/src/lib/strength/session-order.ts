// ── Completed session exercise order ─────────────────────────────────────────
//
// A session's plan (lib/strength/session.ts buildSessionPlan) is always
// re-derived from its template — there is no stored per-session exercise
// list, and a pre-start/mid-session drag reorder is ephemeral client state
// only (see app/strength/page.tsx handleDragEnd/handleStart): nothing is
// ever sent to the server to persist it. That means the ONLY record of what
// order the athlete actually worked through their exercises in is the sets
// they logged, timestamped as they went.
//
// This is deliberately independent of `set_number`, which is a per-exercise
// counter (1, 2, 3… within that exercise's own sets, unique on
// (session, exercise, set_number)) — it says nothing about when one
// exercise's sets happened relative to another's.

export interface OrderableSet {
  exerciseId: string;
  createdAt: string | Date;
}

/**
 * Returns each set's exerciseId, deduplicated, ordered by when that exercise
 * was FIRST logged this session — not last-logged, so a bonus/extra set done
 * on an earlier exercise after finishing a later one doesn't drag that
 * earlier exercise back down the list.
 *
 * Ties (identical timestamp, e.g. two sets upserted in the same millisecond)
 * keep whatever order the sets appeared in the input array, so the result is
 * always deterministic for a given input.
 */
export function firstLoggedExerciseOrder(sets: OrderableSet[]): string[] {
  const firstSeenIndex = new Map<string, number>();
  const firstLoggedAt = new Map<string, number>();

  sets.forEach((s, i) => {
    const t = new Date(s.createdAt).getTime();
    if (!firstSeenIndex.has(s.exerciseId)) firstSeenIndex.set(s.exerciseId, i);
    const known = firstLoggedAt.get(s.exerciseId);
    if (known === undefined || t < known) firstLoggedAt.set(s.exerciseId, t);
  });

  return [...firstLoggedAt.keys()].sort((a, b) => {
    const diff = firstLoggedAt.get(a)! - firstLoggedAt.get(b)!;
    if (diff !== 0) return diff;
    return firstSeenIndex.get(a)! - firstSeenIndex.get(b)!;
  });
}
