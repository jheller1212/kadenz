// Pure data-shaping for the activity detail heart-rate chart, pulled out of
// activity/[id]/page.tsx so it can be unit tested without rendering SVG.
//
// A strength activity has no distance, so plotting HR against distance (the
// run case) collapses every sample onto the same x — distanceKm is 0, and
// the distance-less fallback divides by it. Elapsed time is the axis that
// always makes sense for strength, and it's what the lifter actually wants:
// heart rate over the session.

export interface ActivityChartStreams {
  distance: number[];
  time: number[];
  heartrate?: number[];
}

// Same "is this strength" signal the activities feed uses
// (api/activities/route.ts): either already linked to a strength session
// (server resolves sportType to "strength" in that case), or the device
// reported one of Garmin/Strava's strength-ish sport types.
export function isStrengthActivity(sportType: string | null): boolean {
  return (
    sportType === "strength" ||
    sportType === "WeightTraining" ||
    sportType === "Workout" ||
    sportType === "Crossfit" ||
    sportType === "HIIT"
  );
}

export type HrChartAxis = "time" | "distance";

export interface HrChartData {
  /** null when there's nothing worth charting (no/too-short HR stream). */
  heartrate: number[] | null;
  xData: number[];
  axis: HrChartAxis;
}

export function buildHeartRateChartData(
  streams: ActivityChartStreams | null,
  sportType: string | null,
  distanceKm: number
): HrChartData {
  if (!streams?.heartrate || streams.heartrate.length < 2) {
    return { heartrate: null, xData: [], axis: "distance" };
  }

  if (isStrengthActivity(sportType)) {
    const xData = streams.time.length === streams.heartrate.length
      ? streams.time
      : streams.heartrate.map((_, i) => i);
    return { heartrate: streams.heartrate, xData, axis: "time" };
  }

  const xData =
    streams.distance.length > 0
      ? streams.distance.map((d) => d / 1000)
      : streams.heartrate.map((_, i) => (i / streams.heartrate!.length) * distanceKm);
  return { heartrate: streams.heartrate, xData, axis: "distance" };
}
