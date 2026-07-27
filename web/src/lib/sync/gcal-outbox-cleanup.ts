// ── Sweep dead-on-arrival pending gcal outbox jobs ──────────────────────────
// Google Calendar sync has been down long enough (expired grant, and before
// that unset OAuth env vars) that pending gcal jobs just pile up instead of
// draining. Some of them are for workouts on plans archived long ago — the
// moment the grant is reconnected, the queue would drain and dump every one
// of those stale events onto the calendar. This finds and cancels the ones
// that can never be valid again: the entity is gone, or its plan is archived.
// Never touches a job for the active plan.

import { and, eq, inArray } from "drizzle-orm";
import { db, syncOutbox, workouts, strengthSessions, plans } from "@/db";
import {
  selectCancellableJobs,
  type OutboxJobCandidate,
  type EntityPlanStatus,
} from "./gcal-outbox-cleanup-rules";

export interface OutboxCleanupResult {
  pendingBefore: number;
  cancellable: number;
  cancelled: number;
  pendingAfter: number;
  sample: Array<{
    id: string;
    entityType: "workout" | "strength_session";
    entityId: string;
    reason: string;
  }>;
}

async function buildCandidates(): Promise<OutboxJobCandidate[]> {
  const pending = await db
    .select({
      id: syncOutbox.id,
      entityType: syncOutbox.entityType,
      entityId: syncOutbox.entityId,
    })
    .from(syncOutbox)
    .where(and(eq(syncOutbox.target, "gcal"), eq(syncOutbox.status, "pending")));

  const workoutJobs = pending.filter(
    (j): j is typeof j & { entityType: "workout" } => j.entityType === "workout"
  );
  const strengthJobs = pending.filter(
    (j): j is typeof j & { entityType: "strength_session" } =>
      j.entityType === "strength_session"
  );
  // Jobs for entity types nothing currently queues (week/plan) — nothing to
  // look up, so they can't be classified. Leave them alone rather than guess.
  const otherJobs = pending.filter(
    (j) => j.entityType !== "workout" && j.entityType !== "strength_session"
  );

  const workoutIds = [...new Set(workoutJobs.map((j) => j.entityId))];
  const strengthIds = [...new Set(strengthJobs.map((j) => j.entityId))];

  const [workoutRows, strengthRows] = await Promise.all([
    workoutIds.length
      ? db
          .select({ id: workouts.id, planStatus: plans.status })
          .from(workouts)
          .innerJoin(plans, eq(workouts.planId, plans.id))
          .where(inArray(workouts.id, workoutIds))
      : Promise.resolve([]),
    strengthIds.length
      ? db
          .select({ id: strengthSessions.id, planStatus: plans.status })
          .from(strengthSessions)
          .leftJoin(plans, eq(strengthSessions.planId, plans.id))
          .where(inArray(strengthSessions.id, strengthIds))
      : Promise.resolve([]),
  ]);

  const workoutPlanStatus = new Map<string, EntityPlanStatus>(
    workoutRows.map((r) => [r.id, r.planStatus as EntityPlanStatus])
  );
  const strengthPlanStatus = new Map<string, EntityPlanStatus>(
    // A standalone session (no planId) left-joins to a null plan row —
    // that's "no plan link", not "missing", so it maps to null on purpose.
    strengthRows.map((r) => [r.id, (r.planStatus ?? null) as EntityPlanStatus])
  );

  const candidates: OutboxJobCandidate[] = [];
  for (const j of workoutJobs) {
    const planStatus = workoutPlanStatus.get(j.entityId) ?? null;
    candidates.push({
      id: j.id,
      entityType: "workout",
      entityId: j.entityId,
      entityExists: workoutPlanStatus.has(j.entityId),
      planStatus,
    });
  }
  for (const j of strengthJobs) {
    candidates.push({
      id: j.id,
      entityType: "strength_session",
      entityId: j.entityId,
      entityExists: strengthPlanStatus.has(j.entityId),
      planStatus: strengthPlanStatus.get(j.entityId) ?? null,
    });
  }
  void otherJobs; // deliberately excluded — see comment above

  return candidates;
}

async function countPending(): Promise<number> {
  const rows = await db
    .select({ id: syncOutbox.id })
    .from(syncOutbox)
    .where(and(eq(syncOutbox.target, "gcal"), eq(syncOutbox.status, "pending")));
  return rows.length;
}

export async function previewGcalOutboxCleanup(): Promise<
  Omit<OutboxCleanupResult, "cancelled" | "pendingAfter">
> {
  const candidates = await buildCandidates();
  const toCancel = selectCancellableJobs(candidates);
  return {
    pendingBefore: candidates.length,
    cancellable: toCancel.length,
    sample: toCancel.slice(0, 20).map((j) => ({
      id: j.id,
      entityType: j.entityType,
      entityId: j.entityId,
      reason: j.entityExists ? "archived_plan" : "orphan_entity",
    })),
  };
}

export async function applyGcalOutboxCleanup(): Promise<OutboxCleanupResult> {
  const pendingBefore = await countPending();
  const candidates = await buildCandidates();
  const toCancel = selectCancellableJobs(candidates);

  if (toCancel.length > 0) {
    await db
      .update(syncOutbox)
      .set({ status: "cancelled", processedAt: new Date() })
      .where(
        inArray(
          syncOutbox.id,
          toCancel.map((j) => j.id)
        )
      );
  }

  const pendingAfter = await countPending();

  return {
    pendingBefore,
    cancellable: toCancel.length,
    cancelled: toCancel.length,
    pendingAfter,
    sample: toCancel.slice(0, 20).map((j) => ({
      id: j.id,
      entityType: j.entityType,
      entityId: j.entityId,
      reason: j.entityExists ? "archived_plan" : "orphan_entity",
    })),
  };
}
