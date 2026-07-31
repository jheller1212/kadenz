import { NextRequest } from "next/server";
import { db, activities, activityTrash, deletedActivities, strengthSessions, strengthSets } from "@/db";
import { and, eq } from "drizzle-orm";
import { payloadToRow } from "@/lib/activity-trash";
import { garminTombstoneKey } from "@/lib/sync/garmin-activity-import";
import { currentUserId } from "@/db/with-user";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";

// ── POST /api/activities/trash/[id]/restore ──────────────────────────────────
// Re-inserts the original activities row from the trash payload, removes the
// trash entry and the sync tombstones (so future Strava/Garmin syncs treat it
// normally). The activity comes back UNLINKED — deletion reverted its workout /
// strength session to planned; the user can relink from the activity page.

export const POST = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Outside the try below so its 404 reaches withSession directly.
  const trashed = await requireOwned(activityTrash, id);

  try {
    const payload = trashed.payload as Record<string, unknown>;

    // Strength sessions round-trip whole (session row + logged sets).
    if (payload.kind === "strength_session") {
      const sess = payload.session as Record<string, unknown>;
      const sets = (payload.sets as Array<Record<string, unknown>>) ?? [];
      const toDate = (v: unknown) => (v ? new Date(v as string) : null);
      // The trashed row is a JSONB blob, so its shape is unknown to the type
      // system and a cast is unavoidable. It goes through `unknown` because the
      // spread of an untyped payload overlaps with the insert type only by
      // accident, and TypeScript is right to say so. The fields that MATTER are
      // set explicitly below the spread, so they win regardless of what the
      // payload carried.
      const restored = {
        ...sess,
        date: toDate(sess.date)!,
        createdAt: toDate(sess.createdAt) ?? new Date(),
        updatedAt: new Date(),
        // requireOwned already proved this trash row is the caller's, so the
        // restored session is unconditionally reassigned to them rather than
        // trusting whatever userId happens to be in the trashed payload. This
        // one line is why a restore cannot be used to resurrect a row under
        // someone else's ownership.
        userId: currentUserId(),
        // Trashing already queued deletion of the old calendar event and watch
        // workout (see sessions/[id]/trash/route.ts), so restoring the same ids
        // here would leave the row pointing at entities that no longer exist.
        // The normal push paths recreate them if eligible.
        gcalEventId: null,
        garminWorkoutId: null,
      } as unknown as typeof strengthSessions.$inferInsert;

      await db.insert(strengthSessions).values(restored).onConflictDoNothing();
      if (sets.length > 0) {
        await db
          .insert(strengthSets)
          .values(
            // Same JSONB caveat as the session above. strength_sets carries no
            // user_id of its own: its policy reaches through session_id to the
            // parent, which the insert above has just reassigned to the caller.
            sets.map(
              (st) =>
                ({
                  ...st,
                  createdAt: toDate(st.createdAt) ?? new Date(),
                }) as unknown as typeof strengthSets.$inferInsert
            )
          )
          .onConflictDoNothing();
      }
      await db.delete(activityTrash).where(and(eq(activityTrash.id, id), ownedBy(activityTrash)));
      return Response.json({ ok: true });
    }

    const row = payloadToRow(payload);
    // Deletion reverted the linked workout/strength session to planned; don't
    // silently mark them completed again on restore.
    row.workoutId = null;
    row.strengthSessionId = null;
    // Same reassignment as the strength-session branch above: the caller's
    // ownership of the trash row is what's proven, not whatever userId the
    // stored payload carries.
    row.userId = currentUserId();

    const [restored] = await db
      .insert(activities)
      .values(row)
      .onConflictDoNothing()
      .returning();

    await db.delete(activityTrash).where(and(eq(activityTrash.id, id), ownedBy(activityTrash)));

    if (row.stravaId) {
      await db
        .delete(deletedActivities)
        .where(and(eq(deletedActivities.stravaId, row.stravaId), eq(deletedActivities.userId, currentUserId())));
    }
    if (row.garminId) {
      await db
        .delete(deletedActivities)
        .where(
          and(
            eq(deletedActivities.stravaId, garminTombstoneKey(row.garminId)),
            eq(deletedActivities.userId, currentUserId())
          )
        );
    }

    return Response.json(restored ?? { ok: true });
  } catch (err) {
    console.error("DB error restoring trashed activity:", err);
    return Response.json({ error: "Failed to restore" }, { status: 500 });
  }
});
