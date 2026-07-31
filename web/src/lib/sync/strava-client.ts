import { db, syncOutbox, activities, workouts, plans, strengthSessions, strengthSets, deletedActivities, activityTrash } from "@/db";
import { eq, and, gte, lte, ne, isNull, inArray, sql } from "drizzle-orm";
import { currentUserId } from "@/db/with-user";
import { isConnected as isGcalConnected } from "@/lib/sync/gcal-client";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { loadCredentials, saveCredentials } from "@/lib/sync/credentials";
import { isDuplicateActivity } from "./garmin-import";
import { pickWorkoutMatch } from "./workout-match";
import { pickStrengthSessionMatch, type StrengthSessionCandidate } from "./strength-match";
import { rowToPayload } from "@/lib/activity-trash";
import {
  isRunActivity,
  isStrengthActivity,
  commonStravaFields,
  runStravaFields,
  stravaUpdateFields,
  type StravaActivity,
} from "./strava-activity-fields";
import { buildProviderExternalId } from "@/lib/activity-provider";

// A Strava activity must be at least this long to auto-complete ("lock") a
// planned strength session — guards against accidental / trivial recordings.
const MIN_STRENGTH_MATCH_SECONDS = 5 * 60;

// Same run arriving from the other source (a watch that uploads to both
// Strava and Garmin is a common setup). Mirrors garmin-activity-import.ts's
// isDuplicate() so the cross-source dedup is symmetric: whichever activity
// lands second sees the first one already sitting in `activities` and backs
// off, regardless of which source went first. The actual start+duration
// tolerance lives in the shared pure isDuplicateActivity (garmin-import.ts);
// this window just bounds the candidate query.
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

async function isDuplicateOfExisting(
  startDate: Date,
  durationSeconds: number | null
): Promise<boolean> {
  const nearby = await db
    .select({
      startDate: activities.startDate,
      durationSeconds: activities.durationSeconds,
    })
    .from(activities)
    .where(
      and(
        gte(activities.startDate, new Date(startDate.getTime() - DEDUPE_WINDOW_MS)),
        lte(activities.startDate, new Date(startDate.getTime() + DEDUPE_WINDOW_MS))
      )
    );
  return isDuplicateActivity({ startDate, durationSeconds }, nearby);
}

// ── Token storage ─────────────────────────────────────────────────────────────
// Per-user, via lib/sync/credentials.ts. Before Phase 4 these lived in one
// sync_outbox row shared by the whole installation, so the second person to
// connect Strava overwrote the first person's tokens. See credentials.ts for
// the full story.

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix epoch seconds
  athlete_id: number;
}

export async function loadTokens(userId: string): Promise<StravaTokens | null> {
  // Reached from the Strava webhook too (via getAccessToken → fetchActivity),
  // where `userId` comes from findUserByProviderAccount rather than from a
  // session. Once row-level security lands, this load has to run inside
  // withUser(userId, ...): the webhook is what ESTABLISHES the user context
  // here, it doesn't arrive with one the way a session-authenticated route
  // does.
  return loadCredentials<StravaTokens>(userId, "strava");
}

export async function saveTokens(userId: string, tokens: StravaTokens): Promise<void> {
  // The athlete id the webhook looks callers up by lives in user_identities,
  // not here (see credentials.ts findUserByProviderAccount). Connecting
  // Strava IS logging in with Strava (api/auth/strava/callback), so that
  // identity row already exists by the time this runs.
  await saveCredentials(userId, "strava", tokens as unknown as Record<string, unknown>);
}

export async function isConnected(userId: string): Promise<boolean> {
  return (await loadTokens(userId)) !== null;
}

// ── Webhook subscription ─────────────────────────────────────────────────────
// Deliberately still a single installation-wide row, unlike the tokens above:
// Strava allows exactly one push subscription per APPLICATION, not per user
// (see getWebhookSubscription/registerWebhookSubscription below), so there is
// no "which user" to key this by. It stays keyed by a fixed idempotency key
// in sync_outbox, the same way tokens used to be before they became per-user.

const SUBSCRIPTION_ENTITY_TYPE = "plan" as const;
const SUBSCRIPTION_ENTITY_ID = "00000000-0000-0000-0000-000000000001";
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
      entityType: SUBSCRIPTION_ENTITY_TYPE,
      entityId: SUBSCRIPTION_ENTITY_ID,
      action: "update",
      target: "gcal", // reuse existing enum value — no migration needed
      status: "completed",
      // sync_outbox is tenanted and its user_id default was dropped in phase 3,
      // so the row has to name its owner. There is one Strava subscription for
      // the whole app, and it is recorded under whichever user registered it,
      // which is the same user the webhook re-reads it as.
      userId: currentUserId(),
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
  userId: string,
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

  await saveTokens(userId, refreshed);
  return refreshed;
}

/** Get a valid access token, refreshing if needed. */
export async function getAccessToken(userId: string): Promise<string> {
  let tokens = await loadTokens(userId);
  if (!tokens) throw new Error("Strava not connected");

  // Refresh if expiring within 5 minutes
  if (tokens.expires_at < Date.now() / 1000 + 300) {
    tokens = await refreshAccessToken(userId, tokens);
  }

  return tokens.access_token;
}

// ── Strava API ──────────────────────────────────────────────────────────────

const STRAVA_API = "https://www.strava.com/api/v3";

// Re-exported for existing callers (e.g. the backfill route) — the type now
// lives in strava-activity-fields.ts alongside the pure field mapping.
export type { StravaActivity };

export async function fetchActivity(
  userId: string,
  activityId: number
): Promise<StravaActivity> {
  const token = await getAccessToken(userId);

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
 * exclude rest days. See pickWorkoutMatch for the selection contract.
 */
export async function findMatchingWorkout(
  activity: Pick<StravaActivity, "start_date_local" | "distance">
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
        eq(plans.status, "active")
      )
    );

  if (candidates.length === 0) return null;

  // A workout already backed by a recorded activity — from EITHER source —
  // must never be matched again. stravaActivityId alone can't carry that:
  // Garmin's importRun completes a workout by setting status/actualKm only,
  // never stravaActivityId, so a workout already completed from a Garmin run
  // still looked open to this matcher and could be re-linked (and its
  // actualKm overwritten) by a later Strava upload of the same run. Same
  // "linked activity" check findMatchingStrengthSession already uses below.
  const linked = await db
    .select({ workoutId: activities.workoutId })
    .from(activities)
    .where(inArray(activities.workoutId, candidates.map((c) => c.id)));
  const linkedIds = new Set(linked.map((l) => l.workoutId).filter((id): id is string => id != null));

  return pickWorkoutMatch(candidates, linkedIds, activity.distance / 1000);
}

/**
 * Match a strength activity to a strength session on the same day that isn't
 * already backed by a recorded activity, using time overlap between the
 * activity's recorded window and the session's logged-sets window (see
 * strength-match.ts for the selection rule and tolerance). Returns the
 * session id, or null when no candidate, several equally-good candidates, or
 * none within tolerance — see pickStrengthSessionMatch for the exact rule.
 */
export async function findMatchingStrengthSession(
  activity: { start_date_local: string; moving_time: number }
): Promise<string | null> {
  const start = new Date(activity.start_date_local);
  const end = new Date(start.getTime() + activity.moving_time * 1000);
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const sessions = await db
    .select({ id: strengthSessions.id, status: strengthSessions.status })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, dayStart),
        lte(strengthSessions.date, dayEnd),
        ne(strengthSessions.status, "skipped"),
        // Imports are the owner's activities — never auto-complete a
        // household member's planned session. `activities` has no profileId
        // of its own (it's the owner's watch/Strava feed only), so this is
        // the only place that guest sessions are kept out of auto-matching.
        isNull(strengthSessions.profileId)
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

  // Each open candidate's logged-sets span (min/max createdAt), the real time
  // signal pickStrengthSessionMatch compares against the activity window.
  const spans = await db
    .select({
      sessionId: strengthSets.sessionId,
      minCreatedAt: sql<string>`min(${strengthSets.createdAt})`,
      maxCreatedAt: sql<string>`max(${strengthSets.createdAt})`,
    })
    .from(strengthSets)
    .where(inArray(strengthSets.sessionId, open.map((s) => s.id)))
    .groupBy(strengthSets.sessionId);
  const spanById = new Map(spans.map((s) => [s.sessionId, s]));

  const candidates: StrengthSessionCandidate[] = open.map((s) => {
    const span = spanById.get(s.id);
    return {
      id: s.id,
      status: s.status,
      setsWindow: span
        ? { start: new Date(span.minCreatedAt), end: new Date(span.maxCreatedAt) }
        : null,
    };
  });

  return pickStrengthSessionMatch({ start, end }, candidates);
}

/** Process a Strava activity: store it and match to a workout/session. */
export type ProcessResult = "stored" | "duplicate" | "skipped" | "deleted";

export async function processActivity(userId: string, activityId: number): Promise<ProcessResult> {
  // Never resurrect an activity the user deleted in Kadenz.
  const [tombstone] = await db
    .select({ stravaId: deletedActivities.stravaId })
    .from(deletedActivities)
    .where(eq(deletedActivities.stravaId, String(activityId)))
    .limit(1);
  if (tombstone) return "deleted";

  // Skip if already processed
  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.stravaId, String(activityId)))
    .limit(1);

  if (existing) return "duplicate";

  const activity = await fetchActivity(userId, activityId);
  const isRun = isRunActivity(activity);
  const isStrength = isStrengthActivity(activity);
  if (!isRun && !isStrength) return "skipped";

  const common = commonStravaFields(activity);

  // Cross-source dedup: the same physical run/session may already have
  // arrived via the Garmin worker (a watch that uploads to both is the
  // common case). Check before inserting so the same run never produces two
  // `activities` rows regardless of arrival order.
  if (await isDuplicateOfExisting(new Date(activity.start_date), activity.moving_time)) {
    return "duplicate";
  }

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
      userId,
      strengthSessionId,
      stravaId: String(activityId),
      ...buildProviderExternalId("strava", activityId),
      ...common,
    });
    if (strengthSessionId) {
      // Grab the calendar event id before we clear it, so we can remove the
      // now-completed session from the calendar (auto-cleanup).
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
        isGcalConnected(userId)
          .then((connected) => {
            if (connected) {
              return queueStrengthSessionSync(strengthSessionId, "delete", userId, "gcal", {
                gcalEventId: sess.gcalEventId,
              });
            }
          })
          .catch((err) =>
            console.error("Failed to queue strength calendar cleanup:", err)
          );
      }
    }
    return "stored";
  }

  // ── Run: existing behaviour ────────────────────────────────────────────────
  const run = runStravaFields(activity);
  const workoutId = await findMatchingWorkout(activity);

  // Insert activity record. sportType is normalized to the literal "Run"
  // here (not activity.sport_type, e.g. "TrailRun") — existing behaviour,
  // kept as-is so the feed's type badge doesn't change for already-synced
  // athletes.
  await db.insert(activities).values({
    userId,
    workoutId,
    stravaId: String(activityId),
    ...buildProviderExternalId("strava", activityId),
    ...common,
    sportType: "Run",
    ...run,
  });

  // If matched to a workout, mark it completed
  if (workoutId) {
    await db
      .update(workouts)
      .set({
        status: "completed",
        actualKm: run.distanceKm,
        stravaActivityId: String(activityId),
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, workoutId));
  }
  return "stored";
}

// ── Strava "update" events ───────────────────────────────────────────────────
// Strava sends an "update" event for title/description edits, distance or
// duration corrections (including a cropped activity), and sport-type
// changes. This refreshes the already-stored row with the latest Strava data
// — it never inserts. That keeps the surface an unauthenticated webhook caller
// can affect the same as before: it can change data on a row Kadenz already
// decided to import, never make a new one appear.

export type UpdateResult = "updated" | "not_found" | "trashed" | "not_tracked";

export async function updateActivity(userId: string, activityId: number): Promise<UpdateResult> {
  // Trashed/tombstoned locally — the athlete removed it from Kadenz, so a
  // Strava-side edit must not bring it back. (Belt and suspenders: a trashed
  // row is also gone from `activities`, so the lookup below would miss it
  // anyway — this just makes the "do not resurrect" rule explicit and
  // independent of that.)
  const [tombstone] = await db
    .select({ stravaId: deletedActivities.stravaId })
    .from(deletedActivities)
    .where(eq(deletedActivities.stravaId, String(activityId)))
    .limit(1);
  if (tombstone) return "trashed";

  // Unknown id: either never imported (filtered out by sport type at create —
  // e.g. a Ride, which processActivity deliberately "skipped" and never
  // stored) or an update racing ahead of its own not-yet-finished create
  // (both webhook handlers run async and unordered — see webhook/route.ts).
  // Either way, an update must never be the thing that creates a row; that
  // decision belongs to the "create" path only.
  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.stravaId, String(activityId)))
    .limit(1);
  if (!existing) return "not_found";

  const activity = await fetchActivity(userId, activityId);
  const isRun = isRunActivity(activity);

  // Strava's own type change is honoured on the row (sportType always
  // follows), but a type change never touches workoutId/strengthSessionId or
  // re-runs matching, and never mutates the linked workout/strength session's
  // status or actualKm. Example: a Run edited to a Walk on Strava stays
  // linked to whatever planned workout it completed — silently unlinking a
  // planned workout because Strava relabeled the activity would be a worse
  // surprise than the stale link. If that link is now wrong, the athlete
  // fixes it by hand from the activity detail view (existing UI, unchanged).
  //
  // Distance/pace/elevation/splits/laps/etc. only refresh while the activity
  // is still classified as a Run (matches what create() stores for a Run in
  // the first place). If Strava reclassifies a stored Run away from Run, or a
  // stored strength session's type changes, those run-only fields simply keep
  // their last-synced values rather than guessing at new ones — deliberate,
  // not an oversight.
  const fields = stravaUpdateFields(activity);
  const patch = isRun
    ? fields
    : {
        sportType: fields.sportType,
        name: fields.name,
        startDate: fields.startDate,
        durationSeconds: fields.durationSeconds,
        avgHr: fields.avgHr,
        maxHr: fields.maxHr,
      };

  await db
    .update(activities)
    .set(patch)
    .where(eq(activities.stravaId, String(activityId)));

  return "updated";
}

// ── Strava "delete" events ───────────────────────────────────────────────────
// A hard delete on our side would destroy data because an unauthenticated
// webhook caller said so. Soft-delete into the same trash the manual "delete
// activity" UI already uses (recoverable for 30 days) — the honest middle
// ground: the activity disappears from the feed like the athlete asked, but
// nothing is actually destroyed and a mistaken Strava-side delete (or a
// bulk-delete-then-regret) is recoverable exactly like a manual one.

// "not_found" covers both "never imported" and "already trashed" (manually,
// or by an earlier delivery of this same webhook event — Strava retries) —
// both look identical from here: no row in `activities` for this Strava id.
export type DeleteResult = "trashed" | "not_found";

export async function deleteStravaActivity(userId: string, activityId: number): Promise<DeleteResult> {
  const stravaId = String(activityId);
  const [activity] = await db.select().from(activities).where(eq(activities.stravaId, stravaId));
  // Nothing to do: never imported, or already trashed (manually, or by an
  // earlier delivery of this same event — Strava retries webhooks).
  if (!activity) return "not_found";

  await db
    .insert(activityTrash)
    .values({ id: activity.id, userId, payload: rowToPayload(activity) })
    .onConflictDoNothing();

  if (activity.workoutId) {
    await db
      .update(workouts)
      .set({ status: "planned", actualKm: null, stravaActivityId: null, updatedAt: new Date() })
      .where(eq(workouts.id, activity.workoutId));
  }
  if (activity.strengthSessionId) {
    await db
      .update(strengthSessions)
      .set({ status: "planned", durationMinutes: null, updatedAt: new Date() })
      .where(eq(strengthSessions.id, activity.strengthSessionId));
  }
  await db.insert(deletedActivities).values({ stravaId, userId }).onConflictDoNothing();
  await db.delete(activities).where(eq(activities.id, activity.id));

  return "trashed";
}
