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

export function displayTemp(celsius: number, unit?: "celsius" | "fahrenheit"): number {
  const u = unit ?? loadSettings().tempUnit;
  return u === "fahrenheit" ? Math.round(celsius * 1.8 + 32) : Math.round(celsius);
}
