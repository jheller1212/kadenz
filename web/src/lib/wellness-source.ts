// ── Wellness source precedence ───────────────────────────────────────────────
// wellness_metrics can now hold overnight physiology from more than one
// device for the same night (unique on (source, date), see drizzle/0049).
// Readiness must pick exactly ONE source's history for its rolling baseline
// per computation, never mix them night to night.
//
// Why mixing is wrong, not just messy: Apple Health's HRV figure is SDNN,
// captured sporadically — mostly during short Breathe sessions — while
// Garmin's is rMSSD, sampled continuously overnight. These are different
// measurements of different quantities with different absolute scales. A
// baseline built from a blend of the two isn't a noisier version of the
// truth, it's a number that doesn't correspond to anything physiological.
// Comparing one source's recent nights against another source's baseline is
// just as wrong as comparing them within one blended baseline. So the whole
// baseline-and-recent computation must see nights from a single source.
//
// Why selection happens once, not per night: if two sources both have
// partial history, picking the "best available" source per night would mean
// the readiness signal (and the reasons shown in the UI) flips identity from
// one day to the next as coverage varies — exactly the flip-flopping this
// module exists to prevent. Selecting once per computation, over the whole
// history window, keeps the chosen source stable for as long as it keeps
// clearing the bar.

import type { WellnessNight } from "./physiology";

/** Known wellness_metrics.source values, ranked highest precedence first. */
export const WELLNESS_SOURCE_RANK = ["garmin", "health_connect", "apple_health", "manual"] as const;

export type WellnessSource = (typeof WELLNESS_SOURCE_RANK)[number];

// Ranking rationale (must stay true, not just plausible):
//   1. garmin        — rMSSD, sampled continuously overnight by a dedicated
//                       watch. The most complete and most physiologically
//                       comparable signal available to this app.
//   2. health_connect — Android's aggregation layer; overnight HRV/RHR
//                       coverage depends on the wearable feeding it, but
//                       Android sleep-tracking wearables that report through
//                       Health Connect typically do continuous overnight
//                       capture, similar in kind to Garmin's.
//   3. apple_health   — SDNN, mostly sampled during momentary Breathe
//                       sessions rather than continuously overnight,
//                       so its baseline windows are typically sparser.
//   4. manual         — hand-entered, no continuous overnight capture at
//                       all; last resort only.
const RANK_INDEX: Record<string, number> = Object.fromEntries(
  WELLNESS_SOURCE_RANK.map((s, i) => [s, i])
);

/** Unknown source strings sort after every known source, never crash. */
function rankOf(source: string): number {
  return RANK_INDEX[source] ?? WELLNESS_SOURCE_RANK.length;
}

export interface SourceNights {
  source: string;
  nights: WellnessNight[];
}

export interface SourceSelection {
  source: string | null;
  nights: WellnessNight[];
}

/**
 * Given all nights across all sources, choose the single source the
 * readiness baseline should use for this computation.
 *
 * Rule: prefer the highest-ranked source that has at least
 * `minBaselineNights` of usable history (a night counts if it has any of the
 * three tracked metrics). If none clears that bar, fall back to whichever
 * source has the most nights, so the warm-up progress shown is the best
 * available — ties broken by rank.
 */
export function selectWellnessSource(
  bySource: SourceNights[],
  minBaselineNights: number
): SourceSelection {
  const usable = bySource
    .map((s) => ({
      source: s.source,
      nights: s.nights,
      count: s.nights.filter(
        (n) => n.sleepSeconds != null || n.restingHr != null || n.hrvLastNightAvg != null
      ).length,
    }))
    .filter((s) => s.count > 0);

  if (usable.length === 0) return { source: null, nights: [] };

  const sorted = [...usable].sort((a, b) => {
    const rankDiff = rankOf(a.source) - rankOf(b.source);
    if (rankDiff !== 0) return rankDiff;
    return b.count - a.count;
  });

  const cleared = sorted.filter((s) => s.count >= minBaselineNights);
  if (cleared.length > 0) {
    const best = cleared[0];
    return { source: best.source, nights: best.nights };
  }

  // Nobody cleared the floor — fall back to whoever has the most nights
  // (ties broken by rank, already applied by the sort above), so the
  // warm-up progress reflects the closest-to-ready source.
  const best = [...sorted].sort((a, b) => {
    const countDiff = b.count - a.count;
    if (countDiff !== 0) return countDiff;
    return rankOf(a.source) - rankOf(b.source);
  })[0];
  return { source: best.source, nights: best.nights };
}

/** Human label for a source, for UI copy. Unknown sources fall back to the
 * raw string rather than crashing. */
export function wellnessSourceLabel(source: string | null): string | null {
  switch (source) {
    case "garmin":
      return "Garmin";
    case "apple_health":
      return "Apple Health";
    case "health_connect":
      return "Health Connect";
    case "manual":
      return "Entered by hand";
    default:
      return source;
  }
}
