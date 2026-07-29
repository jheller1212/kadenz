import { Heart } from "lucide-react";

// ── Session-level heart rate card ────────────────────────────────────────────
// Whole-session avg/max from the linked recording (Strava or Garmin), plus
// the honesty caption about what the per-set numbers on the logged sets below
// actually are — see lib/sync/strength-hr.ts alignSetHeartRate for the exact
// derivation this describes.

interface LinkedActivityHr {
  garminId: string | null;
  stravaId: string | null;
  avgHr: number | null;
  maxHr: number | null;
}

export function SessionHeartRate({
  linkedActivity,
  showPerSetCaption,
}: {
  linkedActivity: LinkedActivityHr;
  /** True when at least one logged set has its own avgHr/maxHr reading, so
   *  the caption about what that per-set figure means is actually relevant. */
  showPerSetCaption: boolean;
}) {
  if (linkedActivity.avgHr == null) return null;
  // garminId and stravaId are mutually exclusive on a linked activity — the
  // recording came from whichever service it was synced from.
  const source = linkedActivity.garminId ? "Garmin" : linkedActivity.stravaId ? "Strava" : null;

  return (
    <section className="k-card p-4">
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-danger" strokeWidth={2.2} fill="currentColor" />
        <p className="text-[13px] font-semibold text-text-1">Heart rate</p>
        {source && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-text-3">
            from {source}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-8">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-3">Average</p>
          <p className="text-[22px] font-extrabold tabular-nums text-text-1">
            {linkedActivity.avgHr}
            <span className="text-[12px] font-semibold text-text-3"> bpm</span>
          </p>
        </div>
        {linkedActivity.maxHr != null && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-3">Max</p>
            <p className="text-[22px] font-extrabold tabular-nums text-text-1">
              {linkedActivity.maxHr}
              <span className="text-[12px] font-semibold text-text-3"> bpm</span>
            </p>
          </div>
        )}
      </div>
      {showPerSetCaption && (
        <p className="mt-3 text-[12px] text-text-3">
          Heart rate per set is an average over the window around when the set was logged, not a
          per-rep reading.
        </p>
      )}
    </section>
  );
}
