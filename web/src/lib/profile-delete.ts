// ── Household profile removal guard ─────────────────────────────────────────
// Pulled out of the route handler so the decision logic (three separate ways
// a delete can be refused) is unit-testable without a live database.
//
// There is deliberately no "last remaining profile" guard: the owner has no
// row in `profiles` (NULL profile_id = owner everywhere), so removing every
// guest profile still leaves a working app — just Owner, same as day one.

export interface ProfileDeleteTarget {
  id: string;
  name: string;
  active: boolean;
}

export type ProfileDeleteResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 422; error: string };

/**
 * Decides whether a DELETE for `target` may proceed.
 * `activeProfileId` is the caller's own currently-selected profile (from the
 * kadenz_profile cookie, or null for the owner).
 */
export function evaluateProfileDelete(
  target: ProfileDeleteTarget | undefined,
  confirmName: string,
  activeProfileId: string | null
): ProfileDeleteResult {
  if (target && activeProfileId === target.id) {
    return {
      ok: false,
      status: 409,
      error: "Switch away from this profile before removing it",
    };
  }
  if (!target || !target.active) {
    return { ok: false, status: 404, error: "Profile not found" };
  }
  if (confirmName !== target.name) {
    return { ok: false, status: 422, error: "Confirmation name does not match" };
  }
  return { ok: true };
}
