import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, plans, weeks, workouts } from "@/db";
import {
  listEligibleWeeksToSkip,
  pickDefaultWeekToSkip,
  whyNotSkippable,
  NO_ELIGIBLE_WEEK_MESSAGE,
  type SkipCandidateWeek,
} from "@/lib/plan-engine/week-skip";
import { queueWorkoutEventDeletes } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { queueGarminWorkoutDeletes } from "@/lib/sync/garmin-sync";
import { garminClient } from "@/lib/sync/garmin-client";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";
import { currentUserId } from "@/db/with-user";

async function loadCandidateWeeks(planId: string): Promise<SkipCandidateWeek[]> {
  const rows = await db.query.weeks.findMany({
    where: (w, { eq, and: andOp }) => andOp(eq(w.planId, planId), ownedBy(weeks)),
    orderBy: (w, { asc }) => [asc(w.weekNumber)],
    with: {
      workouts: {
        columns: { id: true, date: true, status: true, gcalEventId: true, garminWorkoutId: true },
      },
    },
  });
  return rows.map((w) => ({
    id: w.id,
    weekNumber: w.weekNumber,
    phase: w.phase,
    skippedAt: w.skippedAt,
    workouts: w.workouts.map((wo) => ({
      id: wo.id,
      date: wo.date,
      status: wo.status,
      gcalEventId: wo.gcalEventId,
      garminWorkoutId: wo.garminWorkoutId,
    })),
  }));
}

// ── GET /api/plans/[id]/skip-week — eligibility ───────────────────────────────

export const GET = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  await requireOwned(plans, id);

  try {
    const candidates = await loadCandidateWeeks(id);
    if (candidates.length === 0) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }
    const now = new Date();
    const eligible = listEligibleWeeksToSkip(candidates, now);
    const suggested = pickDefaultWeekToSkip(eligible, now);
    return Response.json({
      eligible,
      suggestedWeekId: suggested?.weekId ?? null,
      blockedReason: eligible.length === 0 ? NO_ELIGIBLE_WEEK_MESSAGE : null,
    });
  } catch (err) {
    console.error("DB error computing skip-week eligibility:", err);
    return Response.json({ error: "Failed to compute eligibility" }, { status: 500 });
  }
});

// ── POST /api/plans/[id]/skip-week — drop a week ──────────────────────────────

const SkipWeekSchema = z.object({
  weekId: z.string().uuid(),
  reason: z.enum(["illness", "travel", "injury", "other"]).optional(),
}).strict();

export const POST = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Checked before the body is parsed — ownership of the plan does not
  // depend on whether the client sent a valid weekId.
  await requireOwned(plans, id);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = SkipWeekSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 422 });
  }

  try {
    const candidates = await loadCandidateWeeks(id);
    const week = candidates.find((w) => w.id === parsed.data.weekId);
    if (!week) {
      return Response.json({ error: "Week not found" }, { status: 404 });
    }

    // Re-validate server-side — the eligibility list is advisory, this check
    // is the one that actually gates the write. Never trust the client's
    // idea of which week was offered.
    const refusal = whyNotSkippable(week, new Date());
    if (refusal) {
      return Response.json({ error: refusal }, { status: 422 });
    }

    // Only workouts not yet done are cancelled — completed/missed workouts
    // (and anything the athlete had already individually marked skipped)
    // are left exactly as they are, so training history is never touched.
    const toCancel = week.workouts.filter((w) => w.status === "planned");
    const snapshot = toCancel.map((w) => ({ id: w.id, status: w.status }));

    await db.transaction(async (tx) => {
      for (const w of toCancel) {
        await tx
          .update(workouts)
          .set({
            status: "skipped",
            updatedAt: new Date(),
            // Cleared here (delete jobs are queued below with the ids
            // captured before this update runs) so a later undo's "create"
            // — or any other reschedule — never patches/deletes an event
            // that's already gone.
            gcalEventId: null,
            garminWorkoutId: null,
          })
          .where(and(eq(workouts.id, w.id), ownedBy(workouts)));
      }
      await tx
        .update(weeks)
        .set({
          skippedAt: new Date(),
          skipReason: parsed.data.reason ?? null,
          skipSnapshot: snapshot,
        })
        .where(and(eq(weeks.id, week.id), eq(weeks.planId, id), ownedBy(weeks)));
    });

    // Prune calendar/watch events for the cancelled workouts — reuses the
    // same delete path plan-regeneration uses, so orphaned events don't
    // linger on either surface.
    const skipWeekUserId = currentUserId();
    const staleGcal = toCancel
      .filter((w) => !!w.gcalEventId)
      .map((w) => ({ workoutId: w.id, gcalEventId: w.gcalEventId! }));
    if (staleGcal.length > 0) {
      isConnected(skipWeekUserId)
        .then((connected) => {
          if (connected) {
            queueWorkoutEventDeletes(staleGcal, skipWeekUserId).catch((err) =>
              console.error("Failed to queue gcal event deletes for skipped week:", err)
            );
          }
        })
        .catch(() => {});
    }
    const staleGarmin = toCancel
      .filter((w) => !!w.garminWorkoutId)
      .map((w) => ({ workoutId: w.id, garminWorkoutId: w.garminWorkoutId! }));
    if (staleGarmin.length > 0 && garminClient.isConfigured()) {
      queueGarminWorkoutDeletes(skipWeekUserId, staleGarmin).catch((err) =>
        console.error("Failed to queue Garmin workout deletes for skipped week:", err)
      );
    }

    return Response.json({ weekId: week.id, cancelledWorkoutIds: toCancel.map((w) => w.id) });
  } catch (err) {
    console.error("DB error skipping week:", err);
    return Response.json({ error: "Failed to skip week" }, { status: 500 });
  }
});
