import { db, syncOutbox, activities, workouts } from "@/db";
import { eq, and, gte, lte } from "drizzle-orm";

// ── Token storage (same pattern as gcal-client.ts) ──────────────────────────

const TOKEN_ENTITY_TYPE = "plan" as const;
const TOKEN_ENTITY_ID = "00000000-0000-0000-0000-000000000001";
const TOKEN_IDEM_KEY = "strava:tokens:singleton";

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix epoch seconds
  athlete_id: number;
}

export async function loadTokens(): Promise<StravaTokens | null> {
  try {
    const [row] = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(eq(syncOutbox.idempotencyKey, TOKEN_IDEM_KEY))
      .limit(1);

    if (!row?.payload) return null;
    return row.payload as unknown as StravaTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: StravaTokens): Promise<void> {
  await db
    .insert(syncOutbox)
    .values({
      entityType: TOKEN_ENTITY_TYPE,
      entityId: TOKEN_ENTITY_ID,
      action: "update",
      target: "gcal", // reuse existing enum value — no migration needed
      status: "completed",
      idempotencyKey: TOKEN_IDEM_KEY,
      payload: tokens as unknown as Record<string, unknown>,
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { payload: tokens as unknown as Record<string, unknown> },
    });
}

export async function isConnected(): Promise<boolean> {
  return (await loadTokens()) !== null;
}

// ── OAuth2 helpers ──────────────────────────────────────────────────────────

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

function getConfig() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret };
}

export function getAuthUrl(): string {
  const { clientId } = getConfig();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/auth/strava/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
  });

  return `${STRAVA_AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string): Promise<StravaTokens> {
  const { clientId, clientSecret } = getConfig();

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: data.athlete.id,
  };
}

async function refreshAccessToken(
  tokens: StravaTokens
): Promise<StravaTokens> {
  const { clientId, clientSecret } = getConfig();

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const refreshed: StravaTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: tokens.athlete_id,
  };

  await saveTokens(refreshed);
  return refreshed;
}

/** Get a valid access token, refreshing if needed. */
export async function getAccessToken(): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens) throw new Error("Strava not connected");

  // Refresh if expiring within 5 minutes
  if (tokens.expires_at < Date.now() / 1000 + 300) {
    tokens = await refreshAccessToken(tokens);
  }

  return tokens.access_token;
}

// ── Strava API ──────────────────────────────────────────────────────────────

const STRAVA_API = "https://www.strava.com/api/v3";

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  start_date: string; // ISO
  start_date_local: string; // ISO
  average_speed: number; // m/s
  max_speed: number; // m/s
  total_elevation_gain?: number;
  elev_high?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  best_efforts?: Array<{
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
  }>;
  splits_metric?: Array<{
    distance: number;
    elapsed_time: number;
    moving_time: number;
    average_speed: number;
    average_heartrate?: number;
    pace_zone: number;
    split: number;
  }>;
  laps?: Array<{
    id: number;
    name: string;
    distance: number;
    elapsed_time: number;
    moving_time: number;
    average_speed: number;
    average_heartrate?: number;
    max_heartrate?: number;
    lap_index: number;
  }>;
}

export async function fetchActivity(
  activityId: number
): Promise<StravaActivity> {
  const token = await getAccessToken();

  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava API error: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Activity matching & storage ─────────────────────────────────────────────

/**
 * Match a Strava activity to a planned workout by date.
 * Only matches Run activities to non-rest workouts on the same day.
 */
async function findMatchingWorkout(
  activity: StravaActivity
): Promise<string | null> {
  const activityDate = new Date(activity.start_date_local);
  const dayStart = new Date(activityDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(activityDate);
  dayEnd.setHours(23, 59, 59, 999);

  const matches = await db
    .select({ id: workouts.id, type: workouts.type, status: workouts.status })
    .from(workouts)
    .where(
      and(
        gte(workouts.date, dayStart),
        lte(workouts.date, dayEnd),
        eq(workouts.status, "planned")
      )
    )
    .limit(1);

  return matches[0]?.id ?? null;
}

/** Process a Strava activity: store it and match to a workout if possible. */
export async function processActivity(activityId: number): Promise<void> {
  // Skip if already processed
  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.stravaId, String(activityId)))
    .limit(1);

  if (existing) return;

  const activity = await fetchActivity(activityId);

  // Only process runs
  if (activity.sport_type !== "Run" && activity.type !== "Run") return;

  const distanceKm = activity.distance / 1000;
  const avgPaceSecKm =
    activity.average_speed > 0
      ? Math.round(1000 / activity.average_speed)
      : null;

  const workoutId = await findMatchingWorkout(activity);

  // Insert activity record
  await db.insert(activities).values({
    workoutId,
    stravaId: String(activityId),
    name: activity.name,
    startDate: new Date(activity.start_date),
    distanceKm,
    durationSeconds: activity.moving_time,
    avgPaceSecKm,
    avgHr: activity.average_heartrate
      ? Math.round(activity.average_heartrate)
      : null,
    maxHr: activity.max_heartrate
      ? Math.round(activity.max_heartrate)
      : null,
    elevationGain: activity.total_elevation_gain ?? null,
    maxElevation: activity.elev_high ?? null,
    splitsJson: activity.splits_metric ?? null,
    lapsJson: activity.laps ?? null,
  });

  // If matched to a workout, mark it completed
  if (workoutId) {
    await db
      .update(workouts)
      .set({
        status: "completed",
        actualKm: distanceKm,
        stravaActivityId: String(activityId),
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, workoutId));
  }
}
