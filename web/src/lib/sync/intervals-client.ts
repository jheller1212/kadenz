// ── Intervals.icu integration (stub) ──────────────────────────────────────────
//
// Intervals.icu exposes a documented public REST API (API key or OAuth2):
//   https://intervals.icu/api-docs.html
//
// It is the most capable running/endurance integration for Kadenz because it is
// bidirectional and covers exactly what the strength + Achilles module needs:
//   • pull completed activities (running load) — GET /api/v1/athlete/{id}/activities
//   • pull + push wellness (weight, resting HR, HRV, sleep) — /wellness
//   • push planned workouts to the calendar — POST /api/v1/athlete/{id}/events
//
// Auth: an API key from Intervals.icu → Settings → Developer, sent as HTTP Basic
// (username "API_KEY", password = the key). Configure via env:
//   INTERVALS_ICU_ATHLETE_ID, INTERVALS_ICU_API_KEY
//
// This is a typed stub of the surface we intend to use; the network calls are
// intentionally not implemented for the MVP (calendar fan-out via Google
// Calendar covers scheduling today). Filling these in is a self-contained later
// phase and does not touch the rest of the module.

export interface IntervalsWellness {
  /** ISO date (yyyy-mm-dd). */
  id: string;
  weight?: number; // kg
  restingHR?: number;
  hrv?: number; // rMSSD or SDNN depending on source
  sleepSecs?: number;
  soreness?: number; // 1–4 on Intervals' scale
}

export interface IntervalsActivity {
  id: string;
  start_date_local: string;
  type: string; // "Run", "Ride", …
  distance?: number; // metres
  moving_time?: number; // seconds
  icu_training_load?: number;
}

export interface IntervalsEvent {
  start_date_local: string; // ISO
  category: "WORKOUT";
  type: "Workout" | "WeightTraining";
  name: string;
  description?: string;
}

export interface IntervalsClient {
  isConfigured(): boolean;
  /** Completed activities in a date window (running load in). */
  listActivities(oldest: Date, newest: Date): Promise<IntervalsActivity[]>;
  /** Wellness rows (weight, HRV, RHR, sleep) for readiness context. */
  getWellness(from: Date, to: Date): Promise<IntervalsWellness[]>;
  /** Push a wellness row (e.g. logged bodyweight) out to Intervals.icu. */
  putWellness(row: IntervalsWellness): Promise<void>;
  /** Push a planned strength session onto the Intervals calendar. */
  createEvent(event: IntervalsEvent): Promise<string>;
}

function creds(): { athleteId: string; apiKey: string } | null {
  const athleteId = process.env.INTERVALS_ICU_ATHLETE_ID;
  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  if (!athleteId || !apiKey) return null;
  return { athleteId, apiKey };
}

const NOT_IMPLEMENTED = "Intervals.icu sync is stubbed for the MVP (later phase)";

export const intervalsClient: IntervalsClient = {
  isConfigured: () => creds() !== null,
  async listActivities() {
    throw new Error(NOT_IMPLEMENTED);
  },
  async getWellness() {
    throw new Error(NOT_IMPLEMENTED);
  },
  async putWellness() {
    throw new Error(NOT_IMPLEMENTED);
  },
  async createEvent() {
    throw new Error(NOT_IMPLEMENTED);
  },
};
