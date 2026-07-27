// Pure rules for deciding which PENDING gcal outbox jobs can never be
// delivered usefully any more. Kept DB-free so the decision is
// unit-testable — mirrors plan-retire-rules.ts and garmin-heal.ts.

export type EntityPlanStatus = "active" | "archived" | null;

export interface OutboxJobCandidate {
  id: string;
  entityType: "workout" | "strength_session";
  entityId: string;
  // False when the workout/strength_session row itself is gone (cascade
  // delete, or a race with the row's own delete path). A row that no
  // longer exists has nothing left to push to the calendar.
  entityExists: boolean;
  // The plan the entity belongs to, "active"/"archived" if it exists, or
  // null when the entity has no plan link (a standalone strength session)
  // or when entityExists is false (there's nothing to look a plan up on).
  planStatus: EntityPlanStatus;
}

export type CancelReason = "orphan_entity" | "archived_plan";

/**
 * Why (if at all) a job should be cancelled. Never fires for an entity that
 * exists and belongs to the active plan, or has no plan link at all
 * (standalone strength work) — those jobs are still perfectly valid.
 */
export function cancelReason(job: OutboxJobCandidate): CancelReason | null {
  if (!job.entityExists) return "orphan_entity";
  if (job.planStatus === "archived") return "archived_plan";
  return null;
}

export function isCancellable(job: OutboxJobCandidate): boolean {
  return cancelReason(job) !== null;
}

/** Split a batch of pending gcal jobs into the ones to cancel and the rest. */
export function selectCancellableJobs(jobs: OutboxJobCandidate[]): OutboxJobCandidate[] {
  return jobs.filter(isCancellable);
}
