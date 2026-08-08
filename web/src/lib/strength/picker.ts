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
