import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { db, workouts, strengthSessions } from "@/db";
import { isNotNull } from "drizzle-orm";
import { garminClient } from "@/lib/sync/garmin-client";
import { ourOrphanIds, isListingPossiblyPartial } from "@/lib/sync/garmin-heal";

// ── GET /api/sync/reconcile-garmin — two-way Garmin cleanup ─────────────────
// resyncGarminWindow (the daily cron) only ever ADDS: it re-creates workouts
// Kadenz believes it pushed but that vanished from Garmin. It can never reach
// the other kind of orphan — a workout that exists on Garmin but that no row
// in Kadenz references any more, e.g. because a plan was regenerated in place
// and the old workout rows (and their stored ids) were cascade-deleted before
// this reconcile existed. This route lists the account, diffs it against
// every id Kadenz currently tracks, and deletes what's left over.
//
// Deleting is the whole point, so this is deliberately conservative:
//   - a bare call or ?dryRun=1 changes nothing; ?apply=1 is required to delete
//   - only workouts carrying the Kadenz tag (createdByKadenz) are ever
//     candidates — a workout Jonas made on Garmin himself, or another app's,
//     is reported under "notOurs" and never touched
//   - the tracked-id set is built BEFORE listing Garmin; a failure to read
//     either table hard-aborts instead of proceeding with a partial set
//   - if the listing comes back at the worker's page cap, the account may
//     hold more than we can see — refuse to delete rather than treat a
//     partial view as the whole account
//
// Auth mirrors /api/cron/gcal: CRON_SECRET bearer (for a scheduled run) or an
// owner session cookie (so this can be triggered from a logged-in browser).

// The worker's own hard cap (GET /workouts, limit param) — see garmin-worker/main.py.
const LIST_LIMIT = 500;

// One Garmin round-trip per delete; cap per call so the function always
// returns well inside a serverless timeout. The response reports what's
// left so a second ?apply=1 call finishes the job.
const MAX_DELETES_PER_RUN = 20;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const apply = searchParams.get("apply") === "1";

  // Build the tracked-id set BEFORE listing Garmin. A read failure here is a
  // hard abort — proceeding with an incomplete set could delete something
  // that's still in use, e.g. the active plan's workouts.
  let tracked: Set<string>;
  try {
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
    tracked = new Set<string>();
    for (const r of [...runRows, ...strengthRows]) {
      if (r.garminWorkoutId) tracked.add(r.garminWorkoutId);
    }
  } catch (err) {
    console.error("Reconcile aborted: failed to read tracked Garmin ids:", err);
    return Response.json(
      { error: "Failed to read tracked ids from the database; aborted before listing Garmin" },
      { status: 500 }
    );
  }

  let onGarmin;
  try {
    // with_schedules=true so the dry-run sample can show a scheduled date.
    onGarmin = await garminClient.listWorkouts(LIST_LIMIT, true);
  } catch (err) {
    console.error("Garmin reconcile list failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("garmin_auth")) {
      return Response.json({ error: "garmin_auth" }, { status: 503 });
    }
    return Response.json({ error: "Failed to list Garmin workouts" }, { status: 500 });
  }

  if (isListingPossiblyPartial(onGarmin.length, LIST_LIMIT)) {
    return Response.json({
      ok: false,
      error: "listing_capped",
      message:
        `Garmin returned ${onGarmin.length} workouts, the worker's page cap of ${LIST_LIMIT}. ` +
        "The account may hold more than this call can see, so an untracked workout past the " +
        "cap can't be told apart from one that's simply not on this page. A paginated listing " +
        "is needed before reconcile can run safely — refusing to delete on a partial view.",
      onGarmin: onGarmin.length,
      limit: LIST_LIMIT,
    });
  }

  const orphanIdSet = new Set(ourOrphanIds(onGarmin, tracked));
  const orphans = onGarmin.filter((w) => orphanIdSet.has(w.garminWorkoutId));
  const notOurs = onGarmin.filter((w) => !w.createdByKadenz).length;

  const sample = orphans.slice(0, 20).map((w) => ({
    garminWorkoutId: w.garminWorkoutId,
    name: w.name,
    scheduledDates: w.scheduledDates,
  }));

  if (!apply) {
    return Response.json({
      ok: true,
      dryRun: true,
      onGarmin: onGarmin.length,
      trackedByKadenz: tracked.size,
      notOurs,
      orphans: orphans.length,
      sample,
    });
  }

  const batch = orphans.slice(0, MAX_DELETES_PER_RUN);
  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  // Direct worker delete, not the sync_outbox: outbox jobs are keyed to a
  // real workout/strength_session row (entityId) so retries can re-read it.
  // These ids have no owning row by definition — that's what makes them
  // orphans — so there's nothing for a retry to look up. A direct delete
  // with an explicit id list, capped and reported per call, is the outbox's
  // own delete-payload shape without inventing a row to hang it off.
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
    dryRun: false,
    onGarmin: onGarmin.length,
    trackedByKadenz: tracked.size,
    notOurs,
    orphans: orphans.length,
    deleted: deleted.length,
    remaining: orphans.length - deleted.length,
    failed,
  });
}
