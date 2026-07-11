import { type NextRequest } from "next/server";
import { eq, and, lt } from "drizzle-orm";
import { db, syncOutbox } from "@/db";
import { processGCalOutbox } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";

// Failed jobs get one retry per cron run until this hard cap.
const RETRY_CAP = 10;

// ── GET /api/cron/gcal ────────────────────────────────────────────────────────
// Invoked by the Vercel cron (see vercel.json). Authenticated via CRON_SECRET
// (the proxy exempts this path only when the bearer token matches). Requeues
// failed sync jobs, then drains the outbox.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isConnected())) {
    return Response.json({ ok: true, skipped: "gcal not connected" });
  }

  try {
    // Give permanently-failed jobs another chance, up to RETRY_CAP attempts
    const requeued = await db
      .update(syncOutbox)
      .set({ status: "pending" })
      .where(and(eq(syncOutbox.status, "failed"), lt(syncOutbox.attempts, RETRY_CAP)))
      .returning({ id: syncOutbox.id });

    const result = await processGCalOutbox();
    return Response.json({ ok: true, requeued: requeued.length, ...result });
  } catch (err) {
    console.error("GCal cron error:", err);
    return Response.json({ error: "Cron run failed" }, { status: 500 });
  }
}
