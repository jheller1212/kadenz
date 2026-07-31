// A distance or pace edit on an easy/recovery run barely changes what the
// plan means — it's still an aerobic day, just a little longer or shorter.
// The same edit on a long run, tempo or interval session is different: those
// are the sessions a training block is actually built around (see
// plan-generator's phase structure), so a big enough change to one of them
// changes what the block is training, not just what one day looks like. This
// module is the one, DB-free place that judges "big enough" so the edit
// route and the edit UI agree on it instead of drifting.

/** Sessions the plan is structured around — see plan-generator.ts phases.
 *  Easy/recovery/long-shakeout-style days aren't here: they absorb an edit
 *  without changing what the block trains. */
const KEY_SESSION_TYPES = new Set(["long", "tempo", "interval", "race"]);

/** A distance change of a fifth or more measurably changes the training
 *  stimulus of a key session (e.g. a 16k long run cut to 12k is a different
 *  workout, not a shorter version of the same one). */
const MATERIAL_DISTANCE_FRACTION = 0.2;

/** A pace shift of 20 sec/km or more moves a session out of the zone it was
 *  built to train (roughly a full Daniels zone at most paces). */
const MATERIAL_PACE_OFFSET_SEC_KM = 20;

export interface EditImpactInput {
  type: string;
  originalTargetKm: number | null;
  newTargetKm: number | null;
  paceOffsetSecKm: number;
}

/**
 * Whether an in-progress edit would materially change what a key session
 * trains — used to warn the athlete plainly instead of silently absorbing a
 * change that quietly redefines a block.
 */
export function isMaterialEdit(input: EditImpactInput): boolean {
  if (!KEY_SESSION_TYPES.has(input.type)) return false;

  if (
    input.originalTargetKm != null &&
    input.originalTargetKm > 0 &&
    input.newTargetKm != null
  ) {
    const delta = Math.abs(input.newTargetKm - input.originalTargetKm) / input.originalTargetKm;
    if (delta >= MATERIAL_DISTANCE_FRACTION) return true;
  }

  if (Math.abs(input.paceOffsetSecKm) >= MATERIAL_PACE_OFFSET_SEC_KM) return true;

  return false;
}
