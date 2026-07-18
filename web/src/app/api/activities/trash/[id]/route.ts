import { NextRequest } from "next/server";
import { db, activityTrash } from "@/db";
import { eq } from "drizzle-orm";

// ── DELETE /api/activities/trash/[id] ────────────────────────────────────────
// Purges a trashed activity forever. Sync tombstones (deleted_activities) are
// intentionally kept so Strava/Garmin never re-import it.

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [row] = await db
      .delete(activityTrash)
      .where(eq(activityTrash.id, id))
      .returning({ id: activityTrash.id });
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error purging trashed activity:", err);
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}
