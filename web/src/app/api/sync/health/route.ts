import { sql, eq, desc } from "drizzle-orm";
import { db, syncOutbox } from "@/db";
import { withSession } from "@/lib/api/with-session";

// ── GET /api/sync/health ──────────────────────────────────────────────────────
// Outbox health for the Settings "Sync" card: how many jobs are pending/stuck/
// failed per target, when the last one processed, and the most recent errors —
// so "did it actually sync?" is answerable at a glance. DB-only (fast); the
// connection states come from the per-integration status endpoints.
//
// sync_outbox is tenanted (Phase 3) — every query below is the caller's own
// outbox, via withSession's row level security context.

type Counts = { pending: number; processing: number; failed: number; completed: number };

export const GET = withSession(async () => {
  try {
    const rows = await db
      .select({
        target: syncOutbox.target,
        status: syncOutbox.status,
        count: sql<number>`count(*)::int`,
      })
      .from(syncOutbox)
      .groupBy(syncOutbox.target, syncOutbox.status);

    const byTarget: Record<string, Counts> = {};
    for (const r of rows) {
      const t = (byTarget[r.target] ??= { pending: 0, processing: 0, failed: 0, completed: 0 });
      if (r.status in t) t[r.status as keyof Counts] = r.count;
    }

    const [{ lastProcessedAt }] = await db
      .select({ lastProcessedAt: sql<string | null>`max(${syncOutbox.processedAt})` })
      .from(syncOutbox);

    const [{ oldestPending }] = await db
      .select({ oldestPending: sql<string | null>`min(${syncOutbox.createdAt})` })
      .from(syncOutbox)
      .where(eq(syncOutbox.status, "pending"));

    const failures = await db
      .select({
        target: syncOutbox.target,
        action: syncOutbox.action,
        entityType: syncOutbox.entityType,
        attempts: syncOutbox.attempts,
        lastError: syncOutbox.lastError,
        createdAt: syncOutbox.createdAt,
      })
      .from(syncOutbox)
      .where(eq(syncOutbox.status, "failed"))
      .orderBy(desc(syncOutbox.createdAt))
      .limit(8);

    return Response.json({
      byTarget,
      lastProcessedAt,
      oldestPendingMinutes: oldestPending
        ? Math.round((Date.now() - new Date(oldestPending).getTime()) / 60000)
        : null,
      failures,
    });
  } catch (err) {
    console.error("[sync health] failed", err);
    return Response.json({ error: "Failed to load sync health" }, { status: 500 });
  }
});
