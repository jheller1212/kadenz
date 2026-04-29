/** User settings stored in localStorage */

export interface UserSettings {
  /** Show pace targets on workouts */
  paceTargets: boolean;
  /** Show pace targets on easy runs specifically */
  paceTargetsEasyRuns: boolean;
  /** Unit system: "km" or "miles" */
  units: "km" | "miles";
  /** Temperature unit */
  tempUnit: "celsius" | "fahrenheit";
  /** Workout target mode: "pace" or "rpe" */
  workoutTargetMode: "pace" | "rpe";
  /** Theme: "dark" or "light" */
  theme: "dark" | "light";
}

export const DEFAULT_SETTINGS: UserSettings = {
  paceTargets: true,
  paceTargetsEasyRuns: true,
  units: "km",
  tempUnit: "celsius",
  workoutTargetMode: "pace",
  theme: "light",
};

const STORAGE_KEY = "kadenz_settings";

export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
