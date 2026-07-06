// ── Garmin worker client (stub) ───────────────────────────────────────────────
// HTTP client for the Python garmin-worker service (garth). Out of scope for the
// MVP — stubbed interface only, per the strength-module handoff.
//
// Run workouts (TODO — existing scope):
// - createWorkout — POST /workouts (structured workout with pace targets)
// - moveWorkout — PATCH /workouts/:id (reschedule to new date)
// - deleteWorkout — DELETE /workouts/:id
// - healthCheck — GET /health
// - Bearer token auth via GARMIN_WORKER_TOKEN env var
//
// Strength workouts (later phase): garth can push a strength workout with
// exercise category/name, sets, reps and load. The interface below mirrors the
// planned-session shape so the sync-manager can fan out to Garmin the same way
// it does to Google Calendar once the worker endpoint exists.

export interface GarminStrengthExercise {
  name: string;
  category: string;
  sets: number;
  reps: number;
  weightKg?: number | null;
}

export interface GarminStrengthWorkout {
  sessionId: string;
  title: string;
  date: Date;
  exercises: GarminStrengthExercise[];
}

export interface GarminClient {
  isConfigured(): boolean;
  pushStrengthWorkout(workout: GarminStrengthWorkout): Promise<string>;
}

export const garminClient: GarminClient = {
  isConfigured: () => Boolean(process.env.GARMIN_WORKER_URL && process.env.GARMIN_WORKER_TOKEN),
  async pushStrengthWorkout() {
    throw new Error("Garmin strength push is stubbed for the MVP (later phase)");
  },
};
