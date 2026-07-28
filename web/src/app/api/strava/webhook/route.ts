import { type NextRequest } from "next/server";
import {
  processActivity,
  updateActivity,
  deleteStravaActivity,
  loadSubscription,
} from "@/lib/sync/strava-client";

// ── GET: Webhook subscription verification ──────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return Response.json({ "hub.challenge": challenge });
  }

  return Response.json({ error: "Verification failed" }, { status: 403 });
}

// ── POST: Incoming webhook events ───────────────────────────────────────────

interface StravaWebhookEvent {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let event: StravaWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Strava does not sign webhook events — validate the subscription id
  // against the one we registered instead.
  const stored = await loadSubscription();
  if (!stored || event.subscription_id !== stored.subscription_id) {
    return Response.json({ error: "Unknown subscription" }, { status: 403 });
  }

  // `object_type: "athlete"` events (e.g. deauthorization) are not handled —
  // nothing here reads or writes anything on athlete de-auth.
  //
  // All three activity aspects are processed. Strava's "update" event fires
  // for a title/description edit, a distance/duration correction (including
  // a cropped activity), a sport-type change, and a privacy flip — Strava
  // doesn't distinguish which changed, so every "update" triggers the same
  // full refetch-and-refresh. See updateActivity() for exactly which columns
  // follow Strava and which never change (the workout/strength-session link,
  // AI insight, everything Kadenz itself set).
  if (event.object_type === "activity") {
    // Process async — respond to Strava quickly (must reply within 2s).
    // Fire-and-forget means events aren't ordered against each other: an
    // "update" can in principle reach us before its own "create" has
    // finished. updateActivity() treats an unknown id as a no-op rather than
    // creating a row, so that race just drops the update (rare in practice —
    // a title edit requires the athlete to act after the upload already
    // completed) instead of ever inventing data. See strava-client.ts.
    const handler =
      event.aspect_type === "create"
        ? processActivity
        : event.aspect_type === "update"
          ? updateActivity
          : deleteStravaActivity;
    handler(event.object_id).catch((err) => {
      console.error(
        `Failed to process Strava ${event.aspect_type} for activity ${event.object_id}:`,
        err
      );
    });
  }

  // Strava expects 200 for all events
  return Response.json({ ok: true });
}
