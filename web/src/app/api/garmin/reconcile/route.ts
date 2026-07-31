import { type NextRequest } from "next/server";
import { db, workouts, strengthSessions, OWNER_USER_ID } from "@/db";
import { isNotNull } from "drizzle-orm";
import { withUser } from "@/db/with-user";
import { asUserId } from "@/lib/user-id";
import { getSessionUserId } from "@/lib/session";
import { garminClient } from "@/lib/sync/garmin-client";

// ── POST /api/garmin/reconcile ───────────────────────────────────────────────
// Removes leftovers Kadenz itself created on Garmin: duplicates from the old
// move bug, or deletions that never ran while the sync queue was wedged.
//
// A Garmin account is SHARED with other apps and the athlete's own
// hand-made workouts. "Kadenz does not track it" therefore does NOT mean
// "safe to delete" — only workouts carrying the Kadenz tag are ever removed,
// and the caller must pass {"confirm": true} to delete anything at all.
// Without it the route reports what it would do and changes nothing.
//
// This is destructive, so it checks auth itself rather than relying solely
// on the proxy gating every /api/* path — belt and suspenders, in case that
// matching ever changes. Same CRON_SECRET-or-session rule as the other
// reconcile routes.
//
// It is also owner-only: garminClient talks to ONE physical device via
// env-configured worker credentials, not per-user OAuth (see cron/gcal's
// Garmin block for the full reasoning). Every workout/strength session row
// that could ever legitimately carry a garminWorkoutId belongs to the owner,
// so this deliberately does NOT fan out over every user via withCronFanOut —
// there is no "each user's own Garmin" to iterate. A signed-in non-owner
// gets `skipped`, never the owner's real reconcile data.
//
// NOT wrapped in one withUser() covering the whole handler, on purpose: doing
// so would hold Postgres's transaction (and this instance's only DB
// connection — see db/index.ts) open across up to MAX_DELETES_PER_RUN
// sequential Garmin HTTP round-trips, risking an idle-in-transaction timeout
// on a slow Garmin response and turning a slow third party into a database
// problem. Instead: a short withUser() read for the tracked-id set, then
// every Garmin call (listWorkouts, the deletes) runs unwrapped. This gives up
// atomicity between the DB read and the Garmin deletes, but there wasn't any
// to begin with — a Garmin delete can't be rolled back by Postgres regardless
// of how long the transaction stays open.

// Deleting is one Garmin round-trip each; cap per call so the function always
// returns. The response reports what is left so it can simply be run again.
const MAX_DELETES_PER_RUN = 20;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!fromCron) {
    const sessionUserId = await getSessionUserId(request.headers.get("cookie"));
    if (!sessionUserId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (sessionUserId !== OWNER_USER_ID) {
      return Response.json({
        skipped: true,
        reason: "garmin is a single shared device, owner-only",
      });
    }
  }

  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }

  let confirm = false;
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
    confirm = body.confirm === true;
  } catch {
    /* no body → dry run */
  }

  // Read tracked ids in a short-lived owner-scoped transaction, released
  // before any Garmin HTTP call — see the file comment above.
  let tracked: Set<string>;
  try {
    tracked = await withUser(asUserId(OWNER_USER_ID), async () => {
      const [runRows, strengthRows] = await Promise.all([
        db
          .select({ garminWorkoutId: workouts.garminWorkoutId })
          .from(workouts)
          .where(isNotNull(workouts.garminWorkoutId)),
        db
          .select({ garminWorkoutId: strengthSessions.garminWorkoutId })
          .from(strengthSessions)
          .where(isNotNull(strengthSessions.garminWorkoutId)),
      ]);
      const t = new Set<string>();
      for (const r of [...runRows, ...strengthRows]) {
        if (r.garminWorkoutId) t.add(r.garminWorkoutId);
      }
      return t;
    });
  } catch (err) {
    console.error("Garmin reconcile: failed to read tracked ids:", err);
    return Response.json({ error: "Failed to reconcile" }, { status: 500 });
  }

  try {
    const onGarmin = await garminClient.listWorkouts(300);

    // Ours, and no longer referenced by any row. Anything untagged belongs to
    // another app or to the athlete — it is reported, never deleted.
    const orphans = onGarmin.filter(
      (w) => w.createdByKadenz && !tracked.has(w.garminWorkoutId)
    );
    const foreign = onGarmin.filter((w) => !w.createdByKadenz).length;
    const batch = confirm ? orphans.slice(0, MAX_DELETES_PER_RUN) : [];
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const orphan of batch) {
      try {
        await garminClient.deleteWorkout(orphan.garminWorkoutId);
        deleted.push(orphan.garminWorkoutId);
      } catch (err) {
        failed.push({
          id: orphan.garminWorkoutId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return Response.json({
      ok: true,
      dryRun: !confirm,
      onGarmin: onGarmin.length,
      notOurs: foreign,
      trackedByKadenz: tracked.size,
      orphans: orphans.length,
      deleted: deleted.length,
      remaining: orphans.length - deleted.length,
      failed,
    });
  } catch (err) {
    console.error("Garmin reconcile failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("garmin_auth")) {
      return Response.json({ error: "garmin_auth" }, { status: 503 });
    }
    return Response.json({ error: "Failed to reconcile" }, { status: 500 });
  }
}
