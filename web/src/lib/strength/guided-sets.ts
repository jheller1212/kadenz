import type { GuidedWorkSet } from "./guided-snapshot";

// ── Logging an extra set during a guided session ─────────────────────────────
// The API upserts on the unique (session, exercise, setNumber) index, and
// GuidedSession posts `setIndex + 1` as setNumber (see postSet) — a raw,
// order-preserving array position, never renumbered once a set is logged.
// That means the ONLY safe place to add or remove a set is the end of the
// array: inserting or removing in the middle would shift every later index
// away from the setNumber its row was already saved under, silently
// duplicating or orphaning rows. Both functions below enforce that.

/**
 * Append a new working set for "log one more" — the prescription said N
 * sets, the athlete wants N+1. Prefills from the last set in this session's
 * array (whatever the athlete actually just did), not the exercise's
 * template default, so the extra set doesn't reset to a stale starting
 * weight. `fallback` only applies when the exercise has no sets yet (should
 * not happen in practice — "log one more" only appears once the prescribed
 * sets are already done).
 */
export function appendExtraSet(
  arr: GuidedWorkSet[],
  fallback: { kg: number; reps: number }
): GuidedWorkSet[] {
  const prev = arr[arr.length - 1];
  const next: GuidedWorkSet = {
    kg: prev?.kg ?? fallback.kg,
    reps: prev?.reps ?? fallback.reps,
    logged: false,
    durationSec: 0,
    kind: "working",
    extra: true,
  };
  return [...arr, next];
}

export interface RemoveLastExtraResult {
  next: GuidedWorkSet[];
  /** Array index of the removed set (its persisted setNumber is index + 1),
   *  or null when nothing was removed. */
  removedIndex: number | null;
  /** Whether the removed set had already been posted to the server — the
   *  caller must issue a DELETE for it, or the row survives as a phantom
   *  extra set on the session summary. */
  wasLogged: boolean;
}

/**
 * Undo "log one more". Only ever removes the LAST set in the array, and only
 * when it's flagged `extra` (added this session, beyond the prescription) —
 * a prescribed set can never be removed this way.
 */
export function removeLastExtraSet(arr: GuidedWorkSet[]): RemoveLastExtraResult {
  const idx = arr.length - 1;
  const set = arr[idx];
  if (!set?.extra) return { next: arr, removedIndex: null, wasLogged: false };
  return { next: arr.slice(0, -1), removedIndex: idx, wasLogged: set.logged };
}
