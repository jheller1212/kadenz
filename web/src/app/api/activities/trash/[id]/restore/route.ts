import { NextRequest } from "next/server";
import { db, activities, activityTrash, deletedActivities } from "@/db";
import { eq } from "drizzle-orm";
import { payloadToRow } from "@/lib/activity-trash";
import { garminTombstoneKey } from "@/lib/sync/garmin-activity-import";

// ── POST /api/activities/trash/[id]/restore ──────────────────────────────────
// Re-inserts the original activities row from the trash payload, removes the
// trash entry and the sync tombstones (so future Strava/Garmin syncs treat it
// normally). The activity comes back UNLINKED — deletion reverted its workout /
// strength session to planned; the user can relink from the activity page.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [trashed] = await db
      .select()
      .from(activityTrash)
      .where(eq(activityTrash.id, id))
      .limit(1);
    if (!trashed) return Response.json({ error: "Not found" }, { status: 404 });

    const row = payloadToRow(trashed.payload as Record<string, unknown>);
    // Deletion reverted the linked workout/strength session to planned; don't
    // silently mark them completed again on restore.
    row.workoutId = null;
    row.strengthSessionId = null;

    const [restored] = await db
      .insert(activities)
      .values(row)
      .onConflictDoNothing()
      .returning();

    await db.delete(activityTrash).where(eq(activityTrash.id, id));

    if (row.stravaId) {
      await db.delete(deletedActivities).where(eq(deletedActivities.stravaId, row.stravaId));
    }
    if (row.garminId) {
      await db
        .delete(deletedActivities)
        .where(eq(deletedActivities.stravaId, garminTombstoneKey(row.garminId)));
    }

    return Response.json(restored ?? { ok: true });
  } catch (err) {
    console.error("DB error restoring trashed activity:", err);
    return Response.json({ error: "Failed to restore" }, { status: 500 });
  }
}
