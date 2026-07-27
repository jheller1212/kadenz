// Pure GPS fix logic for guided runs, split out of GuidedRun.tsx so it's
// unit-testable without pulling in the whole component tree.

// A fastest-plausible pace to sanity-bound a GPS delta, in m/s. Faster than
// any runner Kadenz needs to support (a sub-3:00/km sprint), used only to
// widen the jump bound after a long gap between accurate fixes.
const MAX_PLAUSIBLE_SPEED_MPS = 8;

// The last fix accepted as the baseline for the next distance delta. Only
// ever set from an accurate fix (see accurateFix below) so a jittery/
// low-accuracy reading can never become the reference point a later, good
// fix is measured against.
export interface GpsFix {
  coords: GeolocationCoordinates;
  timestamp: number;
}

// A fix accurate enough to trust for distance/position, matching the 35m
// threshold GuidedRun has always used.
export function accurateFix(c: Pick<GeolocationCoordinates, "accuracy">): boolean {
  return c.accuracy == null || c.accuracy < 35;
}

// Whether a GPS delta between two accurate fixes is a real movement rather
// than jitter or a teleport. The upper bound widens with elapsed time since
// the last accurate fix: after a long poor-signal stretch (e.g. under trees
// or a bridge) the next good fix can legitimately be much farther from the
// last one, and a fixed 60m cap would wrongly drop that ground. We do not
// want to stop accumulating distance during that stretch, just measure the
// eventual jump against how much time passed, not just space.
export function isPlausibleDelta(distanceM: number, elapsedMs: number): boolean {
  if (distanceM <= 1) return false; // below this is GPS noise, not movement
  const maxDistanceM = Math.max(60, (elapsedMs / 1000) * MAX_PLAUSIBLE_SPEED_MPS);
  return distanceM < maxDistanceM;
}

// Haversine distance between two lat/lng points, in metres.
export function haversine(a: GeolocationCoordinates, b: GeolocationCoordinates): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
