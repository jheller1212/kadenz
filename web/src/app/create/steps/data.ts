import type { PlanIntent, RaceDistance, RunnerLevel, TrainingDifficulty, TrainingVolume } from "@/lib/plan-engine/types";

// ── Plan variants (a curated style per intent) ────────────────────────────────
// Each variant pre-sets a few knobs (difficulty / volume / days) that the later
// steps still show and can override — a friendly front door, not a new input.

export interface PlanVariant {
  key: string;
  label: string;
  sub: string;
  apply: Partial<{
    trainingDifficulty: TrainingDifficulty;
    trainingVolume: TrainingVolume;
    daysPerWeek: number;
  }>;
}

export const VARIANTS: Record<PlanIntent, PlanVariant[]> = {
  race: [
    { key: "balanced", label: "Balanced", sub: "A bit of everything — the classic build", apply: { trainingDifficulty: "moderate" } },
    { key: "speed", label: "Speed-focused", sub: "More quality sessions, sharper legs", apply: { trainingDifficulty: "hard" } },
  ],
  get_fit: [
    { key: "easy", label: "Easy miles", sub: "Almost all relaxed running", apply: { trainingDifficulty: "easy" } },
    { key: "mixed", label: "Easy + a little speed", sub: "Mostly easy with some faster work", apply: { trainingDifficulty: "moderate" } },
  ],
  maintain: [
    { key: "steady", label: "Just ticking over", sub: "Keep the habit, low effort", apply: { trainingDifficulty: "easy", trainingVolume: "low" } },
    { key: "sharp", label: "Keep some sharpness", sub: "Hold fitness with a weekly quality run", apply: { trainingDifficulty: "moderate" } },
  ],
  return: [
    { key: "cautious", label: "Extra cautious", sub: "Fewer sessions, gentler ramp", apply: { daysPerWeek: 3 } },
    { key: "standard", label: "Standard", sub: "The usual return-to-running progression", apply: { daysPerWeek: 4 } },
  ],
};

// ── Distances ────────────────────────────────────────────────────────────────

export const DISTANCE_OPTIONS: { distance: RaceDistance; label: string; sublabel: string }[] = [
  { distance: "5k", label: "5K", sublabel: "3.1 miles" },
  { distance: "10k", label: "10K", sublabel: "6.2 miles" },
  { distance: "half", label: "Half Marathon", sublabel: "13.1 miles" },
  { distance: "marathon", label: "Marathon", sublabel: "26.2 miles" },
  { distance: "ultra", label: "Ultra", sublabel: "50 km · 31 miles" },
];

export const DISTANCE_LABEL: Record<RaceDistance, string> = {
  "5k": "5K",
  "10k": "10K",
  half: "Half Marathon",
  marathon: "Marathon",
  ultra: "Ultra (50K)",
  custom: "Custom",
};

/** Sensible goal-time prefill per distance (seconds). */
export const DEFAULT_GOAL_SECONDS: Record<RaceDistance, number> = {
  "5k": 27 * 60,
  "10k": 55 * 60,
  half: 2 * 3600,
  marathon: 4 * 3600,
  ultra: 5 * 3600 + 30 * 60,
  custom: 30 * 60,
};

// Realistic goal time ranges per distance (seconds) [world record … slow recreational]
export const GOAL_TIME_RANGES: Record<RaceDistance, { wr: number; elite: number; slow: number }> = {
  "5k": { wr: 755, elite: 900, slow: 2700 },
  "10k": { wr: 1577, elite: 1920, slow: 5400 },
  half: { wr: 3456, elite: 4200, slow: 12600 },
  marathon: { wr: 7260, elite: 8700, slow: 25200 },
  ultra: { wr: 9720, elite: 12600, slow: 32400 },
  // Custom distance has no fixed record; validation only requires a positive time.
  custom: { wr: 60, elite: 300, slow: 999999 },
};

// ── Popular races ────────────────────────────────────────────────────────────
// Static, hand-maintained list (no external race API). Dates are the official
// 2026/2027 editions where announced, otherwise the race's traditional slot.

export interface PopularRace {
  id: string;
  name: string;
  location: string;
  date: string; // yyyy-mm-dd
  distance: RaceDistance;
}

export const POPULAR_RACES: PopularRace[] = [
  // Dates verified against official race sources 2026-07-17. London 2027 is a
  // one-off two-day edition (24-25 Apr); we list the Sunday mass day.
  // Copenhagen's 2026 half is the World Athletics Road Running Championships
  // (CPH Half proper skips 2026).
  { id: "berlin-2026", name: "Berlin Marathon", location: "Berlin, Germany", date: "2026-09-27", distance: "marathon" },
  { id: "chicago-2026", name: "Chicago Marathon", location: "Chicago, USA", date: "2026-10-11", distance: "marathon" },
  { id: "amsterdam-2026", name: "Amsterdam Marathon", location: "Amsterdam, Netherlands", date: "2026-10-18", distance: "marathon" },
  { id: "nyc-2026", name: "New York City Marathon", location: "New York, USA", date: "2026-11-01", distance: "marathon" },
  { id: "valencia-2026", name: "Valencia Marathon", location: "Valencia, Spain", date: "2026-12-06", distance: "marathon" },
  { id: "tokyo-2027", name: "Tokyo Marathon", location: "Tokyo, Japan", date: "2027-03-07", distance: "marathon" },
  { id: "boston-2027", name: "Boston Marathon", location: "Boston, USA", date: "2027-04-19", distance: "marathon" },
  { id: "london-2027", name: "London Marathon", location: "London, UK", date: "2027-04-25", distance: "marathon" },
  { id: "copenhagen-half-2026", name: "Copenhagen Half (WRRC 26)", location: "Copenhagen, Denmark", date: "2026-09-20", distance: "half" },
  { id: "valencia-half-2026", name: "Valencia Half Marathon", location: "Valencia, Spain", date: "2026-10-25", distance: "half" },
  { id: "egmond-half-2027", name: "Egmond Half Marathon", location: "Egmond aan Zee, Netherlands", date: "2027-01-10", distance: "half" },
  { id: "cpc-half-2027", name: "CPC Loop Den Haag", location: "The Hague, Netherlands", date: "2027-03-14", distance: "half" },
];

// ── Runner levels ────────────────────────────────────────────────────────────

export interface RunnerLevelOption {
  key: RunnerLevel;
  title: string;
  sub: string;
  fill: number; // radial ring fill 0–1
  defaults: {
    daysPerWeek: number;
    maxDaysPerWeek: number;
    trainingVolume: TrainingVolume;
    trainingDifficulty: TrainingDifficulty;
    currentWeeklyKm: number;
  };
}

export const RUNNER_LEVELS: RunnerLevelOption[] = [
  {
    key: "beginner",
    title: "Beginner",
    sub: "You're new to running or run up to 15 km per week, and haven't raced yet.",
    fill: 0.25,
    defaults: { daysPerWeek: 3, maxDaysPerWeek: 4, trainingVolume: "low", trainingDifficulty: "easy", currentWeeklyKm: 10 },
  },
  {
    key: "intermediate",
    title: "Intermediate",
    sub: "You run 25–40 km per week and have raced a 10K.",
    fill: 0.5,
    defaults: { daysPerWeek: 4, maxDaysPerWeek: 5, trainingVolume: "medium", trainingDifficulty: "moderate", currentWeeklyKm: 30 },
  },
  {
    key: "advanced",
    title: "Advanced",
    sub: "You run 40–70 km per week and regularly race, including structured speed work.",
    fill: 0.75,
    defaults: { daysPerWeek: 5, maxDaysPerWeek: 6, trainingVolume: "high", trainingDifficulty: "moderate", currentWeeklyKm: 50 },
  },
  {
    key: "elite",
    title: "Elite",
    sub: "You run 70+ km per week and race competitively at the sharp end of your age group.",
    fill: 1,
    defaults: { daysPerWeek: 6, maxDaysPerWeek: 6, trainingVolume: "high", trainingDifficulty: "hard", currentWeeklyKm: 75 },
  },
];

// ── Days ─────────────────────────────────────────────────────────────────────

/** Monday-first day list, value = JS weekday (0=Sun … 6=Sat). */
export const DAY_OPTIONS = [
  { name: "Mon", value: 1 },
  { name: "Tue", value: 2 },
  { name: "Wed", value: 3 },
  { name: "Thu", value: 4 },
  { name: "Fri", value: 5 },
  { name: "Sat", value: 6 },
  { name: "Sun", value: 0 },
];

/** Suggested availability per days/week — evenly spaced with recovery between. */
export const SUGGESTED_DAYS: Record<number, number[]> = {
  2: [3, 6],
  3: [1, 3, 6],
  4: [1, 3, 5, 0],
  5: [1, 2, 4, 5, 0],
  6: [1, 2, 3, 4, 5, 0],
};

/** Preferred long-run day within a set: Saturday, else Sunday, else the latest day. */
export function suggestLongRunDay(days: number[]): number {
  if (days.includes(6)) return 6;
  if (days.includes(0)) return 0;
  const monFirst = [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
  return monFirst[monFirst.length - 1] ?? 6;
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

export function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function isoToday(): string {
  return new Date().toISOString().split("T")[0];
}

export function isoDateOffset(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split("T")[0];
}

/** ISO date of the next Monday (strictly after today). */
export function isoNextMonday(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun
  const delta = dow === 1 ? 7 : ((8 - dow) % 7 || 7);
  d.setDate(d.getDate() + delta);
  return d.toISOString().split("T")[0];
}

export function weeksBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.floor(ms / (7 * 24 * 3600 * 1000));
}

export function formatRaceDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
