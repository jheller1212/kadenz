// Shared time-in-HR-zone helpers. The user's zone bounds are client-side
// (localStorage settings), so pages read them via getUserZoneBounds() and pass
// them to whatever computes seconds — locally for one activity, or as query
// params to /api/stats/hr-zones for monthly aggregates.

import { loadSettings } from "@/lib/settings";
import { estimateMaxHr, getHrZones } from "@/lib/plan-engine/hr-zones";

/** Zone display metadata — mirrors the Customise HR Zones settings page. */
export const HR_ZONE_META = [
  { label: "Zone 1", name: "Recovery", color: "#64748B" },
  { label: "Zone 2", name: "Endurance", color: "#3B82F6" },
  { label: "Zone 3", name: "Tempo", color: "#22C55E" },
  { label: "Zone 4", name: "Threshold", color: "#F2A113" },
  { label: "Zone 5", name: "Anaerobic", color: "#E0402E" },
] as const;

/** Default zone upper bounds as fractions of max HR (zones 1-4). */
export const DEFAULT_ZONE_PCTS = [0.75, 0.82, 0.86, 0.91];

export interface ZoneBounds {
  /** Upper bounds (bpm) for zones 1-4; zone 5 tops out at `max`. */
  bounds: [number, number, number, number];
  /** Max heart rate (bpm) — upper bound of zone 5. */
  max: number;
}

export interface ZoneTime {
  label: string;
  name: string;
  color: string;
  /** Zone floor (bpm, inclusive). Zone 1 floor is 0. */
  minHr: number;
  /** Zone ceiling (bpm, exclusive except zone 5). */
  maxHr: number;
  seconds: number;
  pct: number;
}

/**
 * The user's effective zone bounds: custom bounds from settings when set,
 * otherwise defaults — Karvonen (heart-rate reserve) when a resting HR is
 * known, else flat %-of-max (Tanaka via birth year, age 35 fallback).
 * Client-only — on the server it returns the age-35 defaults.
 */
export function getUserZoneBounds(): ZoneBounds {
  const s = loadSettings();
  const age = s.birthYear ? new Date().getFullYear() - s.birthYear : 35;
  const max = s.maxHrOverride ?? estimateMaxHr(age);
  let bounds: [number, number, number, number];
  if (s.hrZoneBounds && s.hrZoneBounds.length === 4) {
    bounds = s.hrZoneBounds as [number, number, number, number];
  } else if (s.restingHr != null && s.restingHr > 0 && s.restingHr < max) {
    const z = getHrZones(s.restingHr, age, max);
    bounds = [z.z1.max, z.z2.max, z.z3.max, z.z4.max];
  } else {
    bounds = DEFAULT_ZONE_PCTS.map((p) => Math.round(max * p)) as [number, number, number, number];
  }
  return { bounds, max };
}

/** Index (0-4) of the zone a heart-rate sample falls into. */
export function zoneIndexFor(hr: number, { bounds }: ZoneBounds): number {
  for (let z = 0; z < bounds.length; z++) {
    if (hr < bounds[z]) return z;
  }
  return 4;
}

/**
 * Sum seconds spent in each zone from parallel HR / elapsed-time streams
 * (Strava stream format: time[i] is seconds since start at sample i).
 */
export function computeZoneSeconds(
  hrStream: number[] | undefined,
  timeStream: number[] | undefined,
  zoneBounds: ZoneBounds
): ZoneTime[] {
  const { bounds, max } = zoneBounds;
  const zones: ZoneTime[] = HR_ZONE_META.map((m, i) => ({
    ...m,
    minHr: i === 0 ? 0 : bounds[i - 1],
    maxHr: i === 4 ? max : bounds[i],
    seconds: 0,
    pct: 0,
  }));

  if (hrStream && timeStream && hrStream.length >= 2) {
    for (let i = 1; i < hrStream.length; i++) {
      const dt = (timeStream[i] ?? 0) - (timeStream[i - 1] ?? 0);
      if (dt <= 0 || dt > 60) continue; // skip gaps (pauses) and bad samples
      zones[zoneIndexFor(hrStream[i], zoneBounds)].seconds += dt;
    }
  }

  const total = zones.reduce((s, z) => s + z.seconds, 0);
  for (const z of zones) {
    z.pct = total > 0 ? Math.round((z.seconds / total) * 100) : 0;
  }
  return zones;
}

/** "24:35" under an hour, "1:24h" style h:mm above. */
export function formatZoneTime(seconds: number): string {
  // Positive sub-second time reads as 1s, never 0 (nothing shorter than 1s).
  const s = seconds > 0 ? Math.max(1, Math.round(seconds)) : 0;
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** "1h 24m" / "24m" — used in the Stats legend. */
export function formatZoneDuration(seconds: number): string {
  const s = seconds > 0 ? Math.max(1, Math.round(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
