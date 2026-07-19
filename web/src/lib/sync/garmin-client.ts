// ── Garmin worker client ──────────────────────────────────────────────────────
// HTTP client for the Python garmin-worker service (garth). All calls are
// server-side only: Bearer auth via GARMIN_WORKER_TOKEN, base URL via
// GARMIN_WORKER_URL, ~10s timeout per request.

const TIMEOUT_MS = 10_000;

/** The worker's Garmin session died — the worker host needs a re-login. */
export class GarminAuthError extends Error {
  constructor() {
    super("Reconnect Garmin on the worker");
    this.name = "GarminAuthError";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GarminRunBlock {
  type: "warmup" | "work" | "recovery" | "cooldown";
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  targetPaceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceMeters?: number | null;
  repRestSeconds?: number | null;
}

export interface GarminRunWorkoutInput {
  title: string;
  description?: string | null;
  /** ISO date (YYYY-MM-DD) to schedule the workout on Garmin's calendar. */
  scheduledDate: string;
  blocks: GarminRunBlock[];
}

export interface GarminActivity {
  garminId: string;
  name: string;
  activityType: string;
  kind: "run" | "strength" | "other";
  startTimeLocal: string;
  startTimeGMT: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGain: number | null;
  calories: number | null;
}

export interface GarminSplit {
  distanceKm: number;
  durationSeconds: number;
  avgHr?: number | null;
  avgPaceSecPerKm?: number | null;
}

export interface GarminActivityDetail extends GarminActivity {
  splits: GarminSplit[];
  lapCount: number;
}

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

export interface GarminWorkoutSummary {
  garminWorkoutId: string;
  name: string | null;
  sportType: string | null;
  scheduledDates: string[];
}

export interface GarminClient {
  isConfigured(): boolean;
  healthCheck(): Promise<boolean>;
  createWorkout(input: GarminRunWorkoutInput): Promise<string>;
  moveWorkout(garminWorkoutId: string, scheduledDate: string): Promise<void>;
  deleteWorkout(garminWorkoutId: string): Promise<void>;
  listActivities(sinceIso: string, limit?: number): Promise<GarminActivity[]>;
  getActivity(garminId: string): Promise<GarminActivityDetail>;
  pushStrengthWorkout(workout: GarminStrengthWorkout): Promise<string>;
  listWorkouts(limit?: number): Promise<GarminWorkoutSummary[]>;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

function getConfig() {
  const url = process.env.GARMIN_WORKER_URL;
  const token = process.env.GARMIN_WORKER_TOKEN;
  if (!url || !token) {
    throw new Error("GARMIN_WORKER_URL and GARMIN_WORKER_TOKEN must be set");
  }
  return { url: url.replace(/\/$/, ""), token };
}

async function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  const { url, token } = getConfig();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status === 503) {
    // Worker signals a dead Garmin session with 503 {error:"garmin_auth"}.
    const body = (await res.json().catch(() => null)) as
      | { error?: string; detail?: string }
      | null;
    if (body?.error === "garmin_auth" || body?.detail === "garmin_auth") {
      throw new GarminAuthError();
    }
    throw new Error(`Garmin worker unavailable (503)`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Garmin worker error: ${res.status} ${text}`.trim());
  }
  return res;
}

/** Format a workout date as the worker's YYYY-MM-DD (server-local day, same
 * convention as the gcal client's setHours-based event times). */
export function toGarminDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Response normalization ────────────────────────────────────────────────────
// The worker sends garminId as an int and timestamps as Garmin strings
// ("YYYY-MM-DD HH:MM:SS" in the list, ISO-T possible in the detail route).

interface RawGarminActivity {
  garminId: number | string;
  name?: string | null;
  activityType?: string | null;
  kind?: string | null;
  startTimeLocal?: string | null;
  startTimeGMT?: string | null;
  distanceMeters?: number | null;
  durationSeconds?: number | null;
  avgPaceSecPerKm?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  elevationGain?: number | null;
  calories?: number | null;
}

function normalizeActivity(raw: RawGarminActivity): GarminActivity {
  const kind =
    raw.kind === "run" || raw.kind === "strength" ? raw.kind : "other";
  return {
    garminId: String(raw.garminId),
    name: raw.name ?? "",
    activityType: raw.activityType ?? "",
    kind,
    startTimeLocal: raw.startTimeLocal ?? "",
    startTimeGMT: raw.startTimeGMT ?? "",
    distanceMeters: raw.distanceMeters ?? null,
    durationSeconds: raw.durationSeconds ?? null,
    avgPaceSecPerKm: raw.avgPaceSecPerKm ?? null,
    avgHr: raw.avgHr ?? null,
    maxHr: raw.maxHr ?? null,
    elevationGain: raw.elevationGain ?? null,
    calories: raw.calories ?? null,
  };
}

// ── Client ────────────────────────────────────────────────────────────────────

export const garminClient: GarminClient = {
  isConfigured: () =>
    Boolean(process.env.GARMIN_WORKER_URL && process.env.GARMIN_WORKER_TOKEN),

  async healthCheck() {
    try {
      const { url } = getConfig();
      const res = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async createWorkout(input) {
    const res = await workerFetch("/workouts", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        description: input.description ?? null,
        scheduled_date: input.scheduledDate,
        sport_type: "running",
        blocks: input.blocks.map((b) => ({
          type: b.type,
          duration_seconds: b.durationSeconds ?? null,
          distance_meters: b.distanceMeters ?? null,
          target_pace_sec_km: b.targetPaceSecKm ?? null,
          min_pace_sec_km: b.minPaceSecKm ?? null,
          max_pace_sec_km: b.maxPaceSecKm ?? null,
          reps: b.reps ?? null,
          rep_distance_meters: b.repDistanceMeters ?? null,
          rep_rest_seconds: b.repRestSeconds ?? null,
        })),
      }),
    });
    const data = (await res.json()) as {
      garmin_workout_id?: string | number;
      garminWorkoutId?: string | number;
    };
    const id = data.garmin_workout_id ?? data.garminWorkoutId;
    if (id == null) throw new Error("Garmin worker returned no workout id");
    return String(id);
  },

  async moveWorkout(garminWorkoutId, scheduledDate) {
    await workerFetch(`/workouts/${encodeURIComponent(garminWorkoutId)}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_date: scheduledDate }),
    });
  },

  async deleteWorkout(garminWorkoutId) {
    try {
      await workerFetch(`/workouts/${encodeURIComponent(garminWorkoutId)}`, {
        method: "DELETE",
      });
    } catch (err) {
      // Already gone on Garmin — treat as success (idempotent delete).
      if (err instanceof Error && err.message.includes(" 404")) return;
      throw err;
    }
  },

  async listActivities(sinceIso, limit = 200) {
    const params = new URLSearchParams({ since: sinceIso, limit: String(limit) });
    const res = await workerFetch(`/activities?${params}`);
    // Worker wraps the list: {"activities": [...]} (be lenient about a bare array).
    const data = (await res.json()) as
      | { activities?: RawGarminActivity[] }
      | RawGarminActivity[];
    const items = Array.isArray(data) ? data : (data.activities ?? []);
    return items.map(normalizeActivity);
  },

  async getActivity(garminId) {
    const res = await workerFetch(`/activities/${encodeURIComponent(garminId)}`);
    const raw = (await res.json()) as RawGarminActivity & {
      splits?: Array<{
        distanceKm?: number | null;
        durationSeconds?: number | null;
        avgHr?: number | null;
        avgPaceSecPerKm?: number | null;
      }> | null;
      lapCount?: number | null;
    };
    return {
      ...normalizeActivity(raw),
      splits: (raw.splits ?? []).map((s) => ({
        distanceKm: s.distanceKm ?? 0,
        durationSeconds: s.durationSeconds ?? 0,
        avgHr: s.avgHr ?? null,
        avgPaceSecPerKm: s.avgPaceSecPerKm ?? null,
      })),
      lapCount: raw.lapCount ?? 0,
    };
  },

  async listWorkouts(limit = 100) {
    const res = await workerFetch(`/workouts?limit=${limit}`);
    const data = (await res.json()) as { workouts?: GarminWorkoutSummary[] };
    return data.workouts ?? [];
  },

  async pushStrengthWorkout(workout) {
    const res = await workerFetch("/strength-workouts", {
      method: "POST",
      body: JSON.stringify({
        title: workout.title,
        date: toGarminDate(workout.date),
        exercises: workout.exercises.map((e) => ({
          name: e.name,
          category: e.category,
          sets: e.sets,
          reps: e.reps,
          weightKg: e.weightKg ?? null,
        })),
      }),
    });
    const data = (await res.json()) as {
      garminWorkoutId?: string | number;
      garmin_workout_id?: string | number;
    };
    const id = data.garminWorkoutId ?? data.garmin_workout_id;
    if (id == null) throw new Error("Garmin worker returned no workout id");
    return String(id);
  },
};
