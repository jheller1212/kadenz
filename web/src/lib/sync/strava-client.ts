import { db, syncOutbox, activities, workouts, plans, strengthSessions, deletedActivities } from "@/db";
import { eq, and, gte, lte, ne, isNull, inArray } from "drizzle-orm";
import { isConnected as isGcalConnected } from "@/lib/sync/gcal-client";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";

// A Strava activity must be at least this long to auto-complete ("lock") a
// planned strength session — guards against accidental / trivial recordings.
const MIN_STRENGTH_MATCH_SECONDS = 5 * 60;

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

// ── Webhook subscription (same singleton storage pattern) ───────────────────

const SUBSCRIPTION_IDEM_KEY = "strava:subscription:singleton";

interface StoredSubscription {
  subscription_id: number;
  callback_url: string;
}

export async function loadSubscription(): Promise<StoredSubscription | null> {
  try {
    const [row] = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(eq(syncOutbox.idempotencyKey, SUBSCRIPTION_IDEM_KEY))
      .limit(1);

    if (!row?.payload) return null;
    return row.payload as unknown as StoredSubscription;
  } catch {
    return null;
  }
}

async function saveSubscription(sub: StoredSubscription): Promise<void> {
  await db
    .insert(syncOutbox)
    .values({
      entityType: TOKEN_ENTITY_TYPE,
      entityId: TOKEN_ENTITY_ID,
      action: "update",
      target: "gcal", // reuse existing enum value — no migration needed
      status: "completed",
      idempotencyKey: SUBSCRIPTION_IDEM_KEY,
      payload: sub as unknown as Record<string, unknown>,
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { payload: sub as unknown as Record<string, unknown> },
    });
}

interface StravaSubscription {
  id: number;
  callback_url: string;
  created_at?: string;
  updated_at?: string;
}

/** List this application's webhook subscription on Strava (max one per app). */
export async function getWebhookSubscription(): Promise<StravaSubscription | null> {
  const { clientId, clientSecret } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${STRAVA_API}/push_subscriptions?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava subscription list failed: ${res.status} ${text}`);
  }

  const subs = (await res.json()) as StravaSubscription[];
  return subs[0] ?? null;
}

/**
 * Ensure a webhook subscription exists for the given callback URL.
 * Strava allows one subscription per application; if one already exists it is
 * reused (and replaced only when its callback URL differs).
 */
export async function registerWebhookSubscription(
  callbackUrl: string
): Promise<StoredSubscription> {
  const { clientId, clientSecret } = getConfig();
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) throw new Error("STRAVA_WEBHOOK_VERIFY_TOKEN is not set");

  const existing = await getWebhookSubscription();
  if (existing) {
    if (existing.callback_url === callbackUrl) {
      const stored = { subscription_id: existing.id, callback_url: existing.callback_url };
      await saveSubscription(stored);
      return stored;
    }
    // Stale callback (old domain) — delete so we can re-register
    const del = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
    const delRes = await fetch(`${STRAVA_API}/push_subscriptions/${existing.id}?${del}`, {
      method: "DELETE",
    });
    if (!delRes.ok && delRes.status !== 404) {
      const text = await delRes.text();
      throw new Error(`Strava subscription delete failed: ${delRes.status} ${text}`);
    }
  }

  // Strava validates the callback synchronously (GET with hub.challenge)
  const res = await fetch(`${STRAVA_API}/push_subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      callback_url: callbackUrl,
      verify_token: verifyToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava subscription create failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: number };
  const stored = { subscription_id: data.id, callback_url: callbackUrl };
  await saveSubscription(stored);
  return stored;
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
 * Match a Strava activity to a workout on the same day.
 * Candidates come from the active plan only (never archived plans) and
 * exclude rest days. Planned workouts win over manually-completed ones
 * that lack Strava data; ties break on targetKm closest to the actual
 * distance so multi-run days attach to the right session.
 */
async function findMatchingWorkout(
  activity: StravaActivity
): Promise<string | null> {
  const activityDate = new Date(activity.start_date_local);
  const dayStart = new Date(activityDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(activityDate);
  dayEnd.setHours(23, 59, 59, 999);

  const candidates = await db
    .select({
      id: workouts.id,
      status: workouts.status,
      targetKm: workouts.targetKm,
    })
    .from(workouts)
    .innerJoin(plans, eq(workouts.planId, plans.id))
    .where(
      and(
        gte(workouts.date, dayStart),
        lte(workouts.date, dayEnd),
        ne(workouts.type, "rest"),
        eq(plans.status, "active"),
        isNull(workouts.stravaActivityId)
      )
    );

  if (candidates.length === 0) return null;

  const distanceKm = activity.distance / 1000;
  const byDistance = (pool: typeof candidates) =>
    [...pool].sort(
      (a, b) =>
        Math.abs((a.targetKm ?? 0) - distanceKm) -
        Math.abs((b.targetKm ?? 0) - distanceKm)
    )[0];

  const planned = candidates.filter((c) => c.status === "planned");
  const best = planned.length > 0 ? byDistance(planned) : byDistance(candidates);
  return best?.id ?? null;
}

// Strava sport types we treat as a strength/lifting session.
const STRENGTH_SPORT_TYPES = new Set(["WeightTraining", "Workout", "Crossfit", "HIIT"]);

/**
 * Match a Strava strength activity to a strength session on the same day that
 * isn't already backed by a recorded activity. Prefers planned/incomplete
 * sessions. Returns the session id, or null.
 */
async function findMatchingStrengthSession(
  activity: StravaActivity
): Promise<string | null> {
  const d = new Date(activity.start_date_local);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(d);
  dayEnd.setHours(23, 59, 59, 999);

  const sessions = await db
    .select({ id: strengthSessions.id, status: strengthSessions.status })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, dayStart),
        lte(strengthSessions.date, dayEnd),
        ne(strengthSessions.status, "skipped")
      )
    );
  if (sessions.length === 0) return null;

  // Drop sessions that already have a linked activity.
  const linked = await db
    .select({ sid: activities.strengthSessionId })
    .from(activities)
    .where(inArray(activities.strengthSessionId, sessions.map((s) => s.id)));
  const linkedIds = new Set(linked.map((l) => l.sid));
  const open = sessions.filter((s) => !linkedIds.has(s.id));
  if (open.length === 0) return null;

  return (open.find((s) => s.status === "planned") ?? open[0]).id;
}

/** Process a Strava activity: store it and match to a workout/session. */
export async function processActivity(activityId: number): Promise<void> {
  // Never resurrect an activity the user deleted in Kadenz.
  const [tombstone] = await db
    .select({ stravaId: deletedActivities.stravaId })
    .from(deletedActivities)
    .where(eq(deletedActivities.stravaId, String(activityId)))
    .limit(1);
  if (tombstone) return;

  // Skip if already processed
  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.stravaId, String(activityId)))
    .limit(1);

  if (existing) return;

  const activity = await fetchActivity(activityId);
  const sportType = activity.sport_type || activity.type;
  const isRun = activity.sport_type === "Run" || activity.type === "Run";
  const isStrength = STRENGTH_SPORT_TYPES.has(sportType);
  if (!isRun && !isStrength) return;

  const avgHr = activity.average_heartrate ? Math.round(activity.average_heartrate) : null;
  const maxHr = activity.max_heartrate ? Math.round(activity.max_heartrate) : null;

  // ── Strength: store + match to a strength session ──────────────────────────
  if (isStrength) {
    // Only auto-assign/complete a session when the activity is a real session
    // (≥ 5 min). Shorter ones are still stored, but left unlinked so the
    // planned session (and its calendar event) stay put — link manually if wanted.
    const longEnough = activity.moving_time >= MIN_STRENGTH_MATCH_SECONDS;
    const strengthSessionId = longEnough
      ? await findMatchingStrengthSession(activity)
      : null;
    await db.insert(activities).values({
      strengthSessionId,
      sportType,
      stravaId: String(activityId),
      name: activity.name,
      startDate: new Date(activity.start_date),
      durationSeconds: activity.moving_time,
      avgHr,
      maxHr,
    });
    if (strengthSessionId) {
      // Grab the calendar event id before we clear it, so we can remove the
      // now-completed session from the calendar (Benchmark-style auto-cleanup).
      const [sess] = await db
        .select({ gcalEventId: strengthSessions.gcalEventId })
        .from(strengthSessions)
        .where(eq(strengthSessions.id, strengthSessionId));

      await db
        .update(strengthSessions)
        .set({
          status: "completed",
          durationMinutes: Math.max(1, Math.round(activity.moving_time / 60)),
          gcalEventId: null,
          updatedAt: new Date(),
        })
        .where(eq(strengthSessions.id, strengthSessionId));

      if (sess?.gcalEventId) {
        isGcalConnected()
          .then((connected) => {
            if (connected) {
              return queueStrengthSessionSync(strengthSessionId, "delete", "gcal", {
                gcalEventId: sess.gcalEventId,
              });
            }
          })
          .catch((err) =>
            console.error("Failed to queue strength calendar cleanup:", err)
          );
      }
    }
    return;
  }

  // ── Run: existing behaviour ────────────────────────────────────────────────
  const distanceKm = activity.distance / 1000;
  const avgPaceSecKm =
    activity.average_speed > 0
      ? Math.round(1000 / activity.average_speed)
      : null;

  const workoutId = await findMatchingWorkout(activity);

  // Insert activity record
  await db.insert(activities).values({
    workoutId,
    sportType: "Run",
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
