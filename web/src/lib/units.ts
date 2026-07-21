import { loadSettings } from "./settings";

// Display-unit helpers. Weights are STORED in kg and temperatures arrive in
// Celsius; these convert at the display boundary only.

export function formatWeightKg(kg: number | null | undefined, unit?: "kg" | "lbs"): string {
  if (kg == null) return "bodyweight";
  const u = unit ?? loadSettings().weightUnit;
  if (u === "lbs") return `${Math.round(kg * 2.20462 * 2) / 2} lbs`;
  return `${kg} kg`;
}

export function weightUnitLabel(unit?: "kg" | "lbs"): string {
  return (unit ?? loadSettings().weightUnit) === "lbs" ? "lbs" : "kg";
}

export function displayWeight(kg: number, unit?: "kg" | "lbs"): number {
  const u = unit ?? loadSettings().weightUnit;
  return u === "lbs" ? Math.round(kg * 2.20462 * 2) / 2 : kg;
}

const KM_PER_MILE = 1.60934;

/** Convert a stored-km distance to the display unit (km or miles). Storage stays km. */
export function displayDistance(km: number, digits = 1, unit?: "km" | "miles"): number {
  const u = unit ?? loadSettings().units;
  const value = u === "miles" ? km / KM_PER_MILE : km;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function distanceUnitLabel(unit?: "km" | "miles"): "km" | "mi" {
  return (unit ?? loadSettings().units) === "miles" ? "mi" : "km";
}

export function formatDistance(km: number, digits = 1, unit?: "km" | "miles"): string {
  const u = unit ?? loadSettings().units;
  return `${displayDistance(km, digits, u)} ${distanceUnitLabel(u)}`;
}

/** Convert a stored sec/km pace to seconds per displayed unit (sec/mi when miles). */
export function displayPace(secPerKm: number, unit?: "km" | "miles"): number {
  const u = unit ?? loadSettings().units;
  return u === "miles" ? secPerKm * KM_PER_MILE : secPerKm;
}

export function paceUnitLabel(unit?: "km" | "miles"): "/km" | "/mi" {
  return (unit ?? loadSettings().units) === "miles" ? "/mi" : "/km";
}

/** Treadmill speed from a stored sec/km pace, in the display unit (mph when
 *  miles) — a treadmill is set by SPEED, so show it in the athlete's unit. */
export function displaySpeed(secPerKm: number, unit?: "km" | "miles"): number {
  const kmPerHour = 3600 / secPerKm;
  return (unit ?? loadSettings().units) === "miles" ? kmPerHour / KM_PER_MILE : kmPerHour;
}

export function speedUnitLabel(unit?: "km" | "miles"): "km/h" | "mph" {
  return (unit ?? loadSettings().units) === "miles" ? "mph" : "km/h";
}

export function displayTemp(celsius: number, unit?: "celsius" | "fahrenheit"): number {
  const u = unit ?? loadSettings().tempUnit;
  return u === "fahrenheit" ? Math.round(celsius * 1.8 + 32) : Math.round(celsius);
}
