/** User settings stored in localStorage */

export interface UserSettings {
  /** Show pace targets on workouts */
  paceTargets: boolean;
  /** Show pace targets on easy runs specifically */
  paceTargetsEasyRuns: boolean;
  /** Show pace targets on long runs specifically */
  paceTargetsLongRuns: boolean;
  /** Unit system: "km" or "miles" */
  units: "km" | "miles";
  /** Temperature unit */
  tempUnit: "celsius" | "fahrenheit";
  /** Workout target mode: "pace" or "rpe" */
  workoutTargetMode: "pace" | "rpe";
  /** Weight unit for strength tracking */
  weightUnit: "kg" | "lbs";
  /** Theme: "system" follows the device, otherwise forced light/dark */
  theme: "system" | "dark" | "light";
  /** Master switch for in-app haptic feedback */
  hapticsEnabled: boolean;
  /** Birth year, used to estimate max heart rate (Tanaka) */
  birthYear: number | null;
  /** Measured max HR override (bpm); null = estimate from age */
  maxHrOverride: number | null;
  /** Custom HR zone upper bounds (zones 1-4, bpm); null = derived from age */
  hrZoneBounds: number[] | null;
  /** Resting heart rate (bpm); when set, default zones use Karvonen (HRR) */
  restingHr: number | null;

  // ── Kraft (strength) guided-session preferences ──────────────────────────
  /** Auto-start a rest timer after each logged set */
  kraftRestTimer: boolean;
  /** Default rest length in seconds */
  kraftRestSeconds: number;
  /** Show a live timer while performing a set */
  kraftSetTimer: boolean;
  /** Master switch for all audio cues (beeps + voice) */
  kraftAudio: boolean;
  /** Spoken cues (requires kraftAudio) */
  kraftVoice: boolean;
  /** 5-second "get ready" lead-in after skipping/ending rest */
  kraftGetReady: boolean;
  /** Keep the screen awake during a session (Wake Lock) */
  kraftKeepAwake: boolean;

  // ── Guided run preferences ───────────────────────────────────────────────
  /** Master switch for guided-run audio cues (beeps + voice) */
  runAudio: boolean;
  /** Spoken run cues (requires runAudio) */
  runVoice: boolean;
  /** Use GPS for live distance, pace, and split announcements */
  runGps: boolean;
  /** Announce each completed km / mile split */
  runSplitCues: boolean;
  /** Keep the screen awake during a guided run (Wake Lock) */
  runKeepAwake: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  paceTargets: true,
  paceTargetsEasyRuns: true,
  paceTargetsLongRuns: true,
  units: "km",
  tempUnit: "celsius",
  workoutTargetMode: "pace",
  weightUnit: "kg",
  theme: "light",
  hapticsEnabled: true,
  birthYear: null,
  maxHrOverride: null,
  hrZoneBounds: null,
  restingHr: null,
  kraftRestTimer: true,
  kraftRestSeconds: 90,
  kraftSetTimer: true,
  kraftAudio: true,
  kraftVoice: true,
  kraftGetReady: true,
  kraftKeepAwake: true,
  runAudio: true,
  runVoice: true,
  runGps: true,
  runSplitCues: true,
  runKeepAwake: true,
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

/** Fired on window whenever settings are saved (theme, units, …). */
export const SETTINGS_CHANGED_EVENT = "kadenz:settings-changed";

export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}
