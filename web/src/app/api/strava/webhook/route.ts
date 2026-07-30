import { type NextRequest } from "next/server";
import {
  processActivity,
  updateActivity,
  deleteStravaActivity,
  loadSubscription,
} from "@/lib/sync/strava-client";
import { findUserByProviderAccount } from "@/lib/sync/credentials";

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
    // A webhook event carries no session, and no user credential at all: the
    // athlete id in the event body (`owner_id`) is the ONLY identity it has.
    // Resolve it to whoever connected that Strava account; an athlete nobody
    // has connected is not this app's business, so the event is logged and
    // dropped rather than guessed at (never falls back to some default user).
    const userId = await findUserByProviderAccount("strava", String(event.owner_id));
    if (!userId) {
      // Same 200 and the same body as every other event this route handles,
      // returned at the same point (right after this one lookup, never after
      // awaiting any processing): this endpoint is on proxy.ts's public
      // exemption list, so an unauthenticated caller who supplies an
      // arbitrary owner_id must not be able to tell "this athlete is a
      // Kadenz user" from "this athlete isn't" by watching the response body,
      // status, or timing. That would turn the webhook into an oracle for
      // enumerating connected athletes. The resolved user id, and whether
      // resolution succeeded at all, are never put in the response, only in
      // this server-side log line.
      console.warn(
        `Strava ${event.aspect_type} event for unconnected athlete ${event.owner_id} (activity ${event.object_id}), ignoring`
      );
      return Response.json({ ok: true });
    }

    // Process async — respond to Strava quickly (must reply within 2s).
    // Fire-and-forget means events aren't ordered against each other: an
    // "update" can in principle reach us before its own "create" has
    // finished. updateActivity() treats an unknown id as a no-op rather than
    // creating a row, so that race just drops the update (rare in practice,
    // a title edit requires the athlete to act after the upload already
    // completed) instead of ever inventing data. See strava-client.ts.
    const handler =
      event.aspect_type === "create"
        ? processActivity
        : event.aspect_type === "update"
          ? updateActivity
          : deleteStravaActivity;
    handler(userId, event.object_id).catch((err) => {
      console.error(
        `Failed to process Strava ${event.aspect_type} for activity ${event.object_id}:`,
        err
      );
    });
  }

  // Strava expects 200 for all events
  return Response.json({ ok: true });
}
