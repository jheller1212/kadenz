import type { NextRequest } from "next/server";

// ── Household profile selection ───────────────────────────────────────────────
// The active profile is a plain (non-httpOnly) cookie set client-side from
// Settings. No value / invalid value = the owner, whose scoped rows carry a
// NULL profile_id. This is a single-household trust model, not auth.

export const PROFILE_COOKIE = "kadenz_profile";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Active profile id from the request cookie; null = owner. */
export function getActiveProfileId(request: NextRequest): string | null {
  const v = request.cookies.get(PROFILE_COOKIE)?.value;
  return v && UUID_RE.test(v) ? v : null;
}
