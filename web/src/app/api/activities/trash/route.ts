import { db, activityTrash } from "@/db";
import { lt, desc } from "drizzle-orm";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";

const RETENTION_DAYS = 30;

// ── GET /api/activities/trash ────────────────────────────────────────────────
// Lists recently deleted activities (newest first). Entries older than 30 days
// are purged on every read — no cron needed.

export const GET = withSession(async () => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // Row level security scopes this to the caller's own stale rows, same as
    // every other query on this connection, so each athlete's visit to their
    // own trash sweeps their own expired entries, and no explicit user filter
    // is needed on the delete itself.
    await db.delete(activityTrash).where(lt(activityTrash.deletedAt, cutoff));

    const rows = await db
      .select()
      .from(activityTrash)
      .where(ownedBy(activityTrash))
      .orderBy(desc(activityTrash.deletedAt));

    return Response.json(
      rows.map((r) => {
        const p = r.payload as Record<string, unknown>;
        if (p.kind === "strength_session") {
          const sess = p.session as Record<string, unknown>;
          return {
            id: r.id,
            deletedAt: r.deletedAt.toISOString(),
            name: (sess.title as string | null) ?? "Strength session",
            date: (sess.date as string | null) ?? null,
            distanceKm: null,
            sportType: "strength",
          };
        }
        return {
          id: r.id,
          deletedAt: r.deletedAt.toISOString(),
          name: (p.name as string | null) ?? null,
          date: (p.startDate as string | null) ?? null,
          distanceKm: (p.distanceKm as number | null) ?? null,
          sportType: (p.sportType as string | null) ?? null,
        };
      })
    );
  } catch (err) {
    console.error("DB error listing activity trash:", err);
    return Response.json({ error: "Failed to load trash" }, { status: 500 });
  }
});
