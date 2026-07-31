// Parsing for an activity's Strava-shaped detail: splits/laps stored on the
// row as raw Strava JSON, and the "live" fields (best efforts, polyline,
// cadence, calories, device/gear name, streams) fetched from Strava's API
// and cached on first view. Pulled out of api/activities/[id]/route.ts to
// keep that route under the file-size cap. Nothing here touches the
// database, so it stays usable from anywhere that needs the same shapes.

const STRAVA_API = "https://www.strava.com/api/v3";

// ── Types for raw JSON stored in DB ─────────────────────────────────────────

interface RawSplit {
  split: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  elevation_difference?: number;
  pace_zone?: number;
}

interface RawLap {
  lap_index: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

// Strava's streams endpoint returns an ARRAY of { type, data } objects (one
// per requested key), not an object keyed by type — a pre-existing parsing
// bug here (Object.entries on the array elements, which have no `.data`
// property under their `type`/`data` keys themselves) meant this always
// silently returned null and streams never rendered. Fixed alongside adding
// the cache, since caching a permanently-null value has no value.
interface StravaStreamEntry {
  type: "distance" | "heartrate" | "velocity_smooth" | "altitude" | "latlng" | "time";
  data: number[] | [number, number][];
}

interface StravaDetailedActivity {
  name?: string;
  best_efforts?: Array<{
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
  }>;
  // Strava reports running cadence in strides/min (one leg) — ×2 for spm.
  average_cadence?: number;
  calories?: number;
  device_name?: string;
  gear?: { id: string; name: string };
  map?: { summary_polyline?: string };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function parseSplits(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as RawSplit[]).map((s) => ({
    km: s.split,
    paceSecKm:
      s.average_speed > 0 ? Math.round(1000 / s.average_speed) : 0,
    elevationDiff: s.elevation_difference ?? 0,
    ...(s.average_heartrate != null
      ? { avgHr: Math.round(s.average_heartrate) }
      : {}),
  }));
}

export function parseLaps(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as RawLap[]).map((l) => ({
    index: l.lap_index,
    distanceKm: l.distance / 1000,
    durationSeconds: l.moving_time,
    paceSecKm:
      l.average_speed > 0 ? Math.round(1000 / l.average_speed) : 0,
    ...(l.average_heartrate != null
      ? { avgHr: Math.round(l.average_heartrate) }
      : {}),
    ...(l.max_heartrate != null
      ? { maxHr: Math.round(l.max_heartrate) }
      : {}),
  }));
}

// Shape stored in `activities.streams_json` and returned to the client —
// same fields fetchStravaStreams parses off the live Strava response.
export interface ParsedStreams {
  distance: number[];
  time: number[];
  heartrate?: number[];
  velocity?: number[];
  altitude?: number[];
  latlng?: [number, number][];
}

export async function fetchStravaStreams(
  stravaId: string,
  token: string
): Promise<ParsedStreams | null> {
  try {
    const res = await fetch(
      `${STRAVA_API}/activities/${stravaId}/streams?keys=heartrate,velocity_smooth,altitude,latlng,distance,time&resolution=medium`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data: StravaStreamEntry[] = await res.json();
    // Strava returns an array of { type, data } stream objects, keyed off
    // `type` here so the lookups below stay by name.
    const map: Record<string, unknown[]> = {};
    for (const stream of data) {
      if (stream?.type && stream?.data) map[stream.type] = stream.data;
    }
    const timeData = map["time"] as number[] | undefined;
    if (!timeData) return null;
    return {
      distance: (map["distance"] as number[]) ?? [],
      time: timeData,
      ...(map["heartrate"] ? { heartrate: map["heartrate"] as number[] } : {}),
      ...(map["velocity_smooth"]
        ? { velocity: map["velocity_smooth"] as number[] }
        : {}),
      ...(map["altitude"] ? { altitude: map["altitude"] as number[] } : {}),
      ...(map["latlng"]
        ? { latlng: map["latlng"] as [number, number][] }
        : {}),
    };
  } catch {
    return null;
  }
}

export interface StravaLiveDetail {
  bestEfforts: Array<{
    name: string;
    distance: number;
    elapsedTime: number;
    movingTime: number;
  }>;
  polyline: string | null;
  cadenceSpm: number | null; // steps per minute (Strava value ×2)
  calories: number | null;
  deviceName: string | null;
  gearName: string | null;
}

export const EMPTY_LIVE_DETAIL: StravaLiveDetail = {
  bestEfforts: [],
  polyline: null,
  cadenceSpm: null,
  calories: null,
  deviceName: null,
  gearName: null,
};

export async function fetchStravaDetail(
  stravaId: string,
  token: string
): Promise<StravaLiveDetail> {
  try {
    const res = await fetch(`${STRAVA_API}/activities/${stravaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return EMPTY_LIVE_DETAIL;
    const data: StravaDetailedActivity = await res.json();
    return {
      bestEfforts: (data.best_efforts ?? []).map((e) => ({
        name: e.name,
        distance: e.distance,
        elapsedTime: e.elapsed_time,
        movingTime: e.moving_time,
      })),
      polyline: data.map?.summary_polyline || null,
      cadenceSpm:
        data.average_cadence != null && data.average_cadence > 0
          ? Math.round(data.average_cadence * 2)
          : null,
      calories: data.calories != null ? Math.round(data.calories) : null,
      deviceName: data.device_name ?? null,
      gearName: data.gear?.name ?? null,
    };
  } catch {
    return EMPTY_LIVE_DETAIL;
  }
}
