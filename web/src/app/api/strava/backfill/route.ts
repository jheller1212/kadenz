import { type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db, activities, deletedActivities } from "@/db";
import { withUser } from "@/db/with-user";
import {
  getAccessToken,
  processActivity,
  updateActivity,
  type StravaActivity,
} from "@/lib/sync/strava-client";
import { requireRequestUser } from "@/lib/request-user";

// ── Scoping, and why it is per call rather than one transaction for the
// whole request ──────────────────────────────────────────────────────────────
//
// integration_credentials/activities/deleted_activities are all tenanted
// (FORCE row level security — drizzle/0053_rls.sql,
// 0066_rls_covers_every_tenanted_table.sql), so every db call here needs an
// app.user_id set on the transaction it runs on (db/with-user.ts) or it
// matches nothing. This route used to resolve `userId` and pass it straight
// to getAccessToken/processActivity/updateActivity without ever opening one,
// so under FORCE RLS the credential read, the dedupe pre-check, and every
// stored activity all silently matched zero rows: the athlete saw
// `{ ok: true, inserted: 0 }` and nothing was ever imported.
//
// The fix is NOT one withUser wrapping the whole handler. db/with-user.ts's
// own file comment warns against that: a transaction held open across an
// await on a third party turns a slow external call into a database problem,
// and this route can make up to MAX_NEW_PER_RUN (80) sequential Strava round
// trips. Each processActivity/updateActivity call already makes exactly one
// such round trip (fetchActivity) fused with its own reads/writes, so it is
// scoped individually below — 80 short-lived transactions opened and closed
// one at a time, never one held across all 80. The credential read and the
// batch dedupe pre-check are each their own short scope for the same reason,
// just with no network call inside them at all.

const STRAVA_API = "https://www.strava.com/api/v3";
const DEFAULT_LOOKBACK_DAYS = 30;
// Each NEW activity costs one Strava detail request, and the API quota is
// shared across every connected athlete of this app (~100-200 req/15 min).
// Cap the work per invocation; the client loops until done.
const MAX_NEW_PER_RUN = 80;

// ── POST: Backfill recent Strava activities ──────────────────────────────────

export async function POST(request: NextRequest) {
  const { userId, response: unauth } = await requireRequestUser(request);
  if (unauth) return unauth;

  // Parse optional `since` param (ISO date string or Unix epoch seconds)
  let sinceEpoch: number;
  // `refresh: true` repairs already-imported activities instead of skipping
  // them — the manual fix for an edit that happened before update-webhook
  // handling existed (or for one the athlete just wants re-pulled). Same
  // field rules as the live webhook: see updateActivity() for what follows
  // Strava and what's protected. Deliberately opt-in — this never runs on
  // its own, only when explicitly requested.
  let refresh = false;

  try {
    const body = await request.json().catch(() => ({}));
    refresh = body.refresh === true;
    if (body.full === true) {
      sinceEpoch = 1; // everything the athlete ever recorded
    } else if (body.since) {
      const parsed = Number(body.since);
      // Accept either a Unix epoch (number) or an ISO date string
      sinceEpoch = Number.isFinite(parsed)
        ? parsed
        : Math.floor(new Date(body.since).getTime() / 1000);
    } else {
      sinceEpoch = Math.floor(
        (Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000
      );
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Number.isFinite(sinceEpoch) || sinceEpoch <= 0) {
    return Response.json(
      { error: "Invalid `since` value — expected Unix epoch seconds or ISO date string" },
      { status: 400 }
    );
  }

  let token: string;
  try {
    token = await withUser(userId, () => getAccessToken(userId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Strava not connected: ${message}` },
      { status: 503 }
    );
  }

  // Fetch all activities from Strava with pagination
  const stravaActivities: StravaActivity[] = [];
  try {
    let page = 1;
    const perPage = 200; // max allowed by Strava
    while (true) {
      const res = await fetch(
        `${STRAVA_API}/athlete/activities?after=${sinceEpoch}&per_page=${perPage}&page=${page}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Strava API error: ${res.status} ${text}`);
      }

      const batch: StravaActivity[] = await res.json();
      stravaActivities.push(...batch);
      if (batch.length < perPage) break; // no more pages
      page++;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to fetch activities from Strava: ${message}` },
      { status: 502 }
    );
  }

  // Which of the fetched activities are actually NEW? Pre-check stored ids
  // so the result reports real work, not the fetch-window size. No network
  // call in this pair of selects, so one short scope covers both.
  const fetchedIds = stravaActivities.map((a) => String(a.id));
  const { knownActivityIds, tombstoneIds } = await withUser(userId, async () => {
    const existing = fetchedIds.length
      ? await db
          .select({ stravaId: activities.stravaId })
          .from(activities)
          .where(inArray(activities.stravaId, fetchedIds))
      : [];
    // Tombstoned (user-deleted) activities are treated as already handled —
    // `refresh` never touches these, they stay gone regardless.
    const tombstones = fetchedIds.length
      ? await db
          .select({ stravaId: deletedActivities.stravaId })
          .from(deletedActivities)
          .where(inArray(deletedActivities.stravaId, fetchedIds))
      : [];
    return {
      knownActivityIds: new Set(existing.map((e) => e.stravaId)),
      tombstoneIds: new Set(tombstones.map((t) => t.stravaId)),
    };
  });
  const known = new Set([...knownActivityIds, ...tombstoneIds]);

  let inserted = 0;
  let alreadySynced = 0;
  let skippedTypes = 0;
  let refreshed = 0;
  let processedNew = 0;
  let rateLimited = false;
  let remaining = 0;
  const errors: Array<{ id: number; error: string }> = [];

  // Anything that costs a Strava API round-trip this run — a new import or,
  // in refresh mode, a re-fetch of a known activity. Bounded the same way as
  // plain new-activity backfill (see MAX_NEW_PER_RUN) so a `refresh: true,
  // full: true` request can't blow the invocation's time budget or the
  // shared Strava rate limit; the client loops via `remaining` like it
  // already does for new activities.
  const needsRefresh = (id: string) => refresh && knownActivityIds.has(id);

  for (let i = 0; i < stravaActivities.length; i++) {
    const activity = stravaActivities[i];
    const id = String(activity.id);
    const isKnown = known.has(id);
    const willCallApi = !isKnown || needsRefresh(id);
    if (willCallApi && processedNew >= MAX_NEW_PER_RUN) {
      // Chunk boundary: count what's left so the client knows to loop.
      remaining = stravaActivities
        .slice(i)
        .filter((a) => !known.has(String(a.id)) || needsRefresh(String(a.id))).length;
      break;
    }
    try {
      if (isKnown) {
        if (needsRefresh(id)) {
          processedNew++;
          // One activity, one scope, one Strava round trip — see the file
          // comment on why this is per call, not one scope for the loop.
          const result = await withUser(userId, () => updateActivity(userId, activity.id));
          if (result === "updated") refreshed++;
          else alreadySynced++; // not_found / trashed — nothing to refresh
        } else {
          alreadySynced++; // idempotent anyway, but skip the API round-trip
        }
        continue;
      }
      processedNew++;
      const result = await withUser(userId, () => processActivity(userId, activity.id));
      if (result === "stored") inserted++;
      else if (result === "skipped") skippedTypes++;
      else alreadySynced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes(" 429 ")) {
        // Strava quota exhausted — stop politely; everything done so far is
        // stored, a later run resumes via the duplicate pre-check.
        rateLimited = true;
        remaining = stravaActivities
          .slice(i)
          .filter((a) => !known.has(String(a.id)) || needsRefresh(String(a.id))).length;
        break;
      }
      errors.push({ id: activity.id, error: message });
    }
  }

  // Earliest activity Strava returned for the window — lets the client show
  // how far back the athlete's history actually goes.
  const oldest = stravaActivities.reduce<string | null>(
    (min, a) => (min === null || a.start_date < min ? a.start_date : min),
    null
  );

  return Response.json({
    ok: true,
    since: new Date(sinceEpoch * 1000).toISOString(),
    total: stravaActivities.length,
    oldest,
    // `processed` kept for old clients; it now means genuinely new.
    processed: inserted,
    inserted,
    alreadySynced,
    skippedTypes,
    refreshed,
    remaining,
    rateLimited,
    done: remaining === 0 && !rateLimited,
    errors: errors.length > 0 ? errors : undefined,
  });
}
