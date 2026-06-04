import { type NextRequest } from "next/server";
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

  // Fetch activities list from Strava (max 30 per page — matches default per_page)
  let stravaActivities: StravaActivity[];
  try {
    const res = await fetch(
      `${STRAVA_API}/athlete/activities?after=${sinceEpoch}&per_page=30`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Strava API error: ${res.status} ${text}`);
    }

    stravaActivities = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to fetch activities from Strava: ${message}` },
      { status: 502 }
    );
  }

  // Process each activity, collecting results
  let processed = 0;
  let skipped = 0;
  const errors: Array<{ id: number; error: string }> = [];

  for (const activity of stravaActivities) {
    try {
      // processActivity is idempotent — it skips already-stored activities
      // and ignores non-Run sport types internally
      const beforeCount = processed;
      await processActivity(activity.id);
      // We can't easily distinguish "newly inserted" from "already existed"
      // from processActivity's void return, so we count all non-error calls
      processed++;
      void beforeCount; // suppress unused warning
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push({ id: activity.id, error: message });
    }
  }

  skipped = stravaActivities.length - processed - errors.length;

  return Response.json({
    ok: true,
    since: new Date(sinceEpoch * 1000).toISOString(),
    total: stravaActivities.length,
    processed,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
