import type { Complaint, StrengthSessionType } from "./types";

// ── What the Kraft picker offers ─────────────────────────────────────────────
//
// The three standard programme types, plus Rehab for an athlete who reports
// the Achilles complaint.
//
// The weekly rehab pass (reconcile.ts computeAchillesRehabDays) remains the
// primary route to rehab work: it places ~3 non-consecutive days a week,
// either attached to that day's session or standalone, which is what an HSR
// protocol needs and what an athlete cannot reliably do by hand. Hand-picking
// exists alongside it because the athlete is the one who knows the tendon is
// asking for it, and because a scheduler that places nothing — the pattern
// genuinely had no room, or something upstream failed — otherwise leaves them
// with no way to do the work at all.
//
// Gated on the complaint for the same reason the block itself is: a Rehab
// card offered to an athlete with a healthy tendon is a prompt to do loaded
// calf work nobody prescribed.
//
// The upper_achilles/lower_achilles combo types are historic and never
// offered here — they exist only on sessions created before #155.
const BASE_PICKER_TYPES: StrengthSessionType[] = ["full_body", "upper", "lower"];

// Always a fresh array — returning the module-level constant on the
// no-complaint path would hand every caller a handle to the shared list.
export function pickerTypesFor(complaints: Complaint[]): StrengthSessionType[] {
  return complaints.includes("achilles")
    ? [...BASE_PICKER_TYPES, "achilles"]
    : [...BASE_PICKER_TYPES];
}

// ── Does this card's session actually carry the rehab block? ─────────────────
//
// One fact, and it has exactly one source: `achillesAttached` on the session
// itself. The weekly rehab pass decides it per calendar day, so most sessions
// in a week don't carry it even for an athlete who reports the complaint.
//
// The card used to fall back to "does this athlete report the Achilles
// complaint" whenever there was no planned session of that type today, on the
// grounds that a freshly-created session followed the complaint list too. That
// stopped being true in #155: a session created from the picker is written
// with achillesAttached = false (the POST route never sets it), and
// sessionTemplateFor now keys the block on that flag alone — it skips the
// "achilles" complaint explicitly. buildPlannedSession's `hasHsrWork` still
// reads the complaint list, but only to pick the HSR ramp week for a session
// that is carrying the block; it cannot add one.
//
// So the fallback promised rehab work on every card, in every session the
// athlete then started without any. Same shape as the other duplication bugs
// in this repo (docs/DUPLICATION.md): one fact, two places computing it,
// drifting the moment one side changed.
//
// A session that doesn't exist yet will be created with the flag false, so the
// honest answer for it is simply "no".
export function cardCarriesRehabWork(
  type: StrengthSessionType,
  todaysPlannedSession: { achillesAttached?: boolean } | undefined
): boolean {
  // The dedicated Rehab session IS the block — advertising "+ Rehab work" on
  // top of it would read as a second dose.
  if (type === "achilles") return false;
  return Boolean(todaysPlannedSession?.achillesAttached);
}
