import { type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db, activities, deletedActivities } from "@/db";
import {
  getAccessToken,
  processActivity,
  type StravaActivity,
} from "@/lib/sync/strava-client";

const STRAVA_API = "https://www.strava.com/api/v3";
const DEFAULT_LOOKBACK_DAYS = 30;

// ── POST: Backfill recent Strava activities ──────────────────────────────────

export async function POST(request: NextRequest) {
  // Parse optional `since` param (ISO date string or Unix epoch seconds)
  let sinceEpoch: number;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.since) {
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
    token = await getAccessToken();
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
  // so the result reports real work, not the fetch-window size.
  const fetchedIds = stravaActivities.map((a) => String(a.id));
  const existing = fetchedIds.length
    ? await db
        .select({ stravaId: activities.stravaId })
        .from(activities)
        .where(inArray(activities.stravaId, fetchedIds))
    : [];
  const known = new Set(existing.map((e) => e.stravaId));
  // Tombstoned (user-deleted) activities are treated as already handled.
  const tombstones = fetchedIds.length
    ? await db
        .select({ stravaId: deletedActivities.stravaId })
        .from(deletedActivities)
        .where(inArray(deletedActivities.stravaId, fetchedIds))
    : [];
  for (const t of tombstones) known.add(t.stravaId);

  let inserted = 0;
  let alreadySynced = 0;
  const errors: Array<{ id: number; error: string }> = [];

  for (const activity of stravaActivities) {
    try {
      if (known.has(String(activity.id))) {
        alreadySynced++;
        continue; // idempotent anyway, but skip the API round-trips
      }
      await processActivity(activity.id);
      inserted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
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
    errors: errors.length > 0 ? errors : undefined,
  });
}
