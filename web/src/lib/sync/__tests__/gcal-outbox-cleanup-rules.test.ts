import { describe, expect, it } from "vitest";
import {
  cancelReason,
  isCancellable,
  selectCancellableJobs,
  type OutboxJobCandidate,
} from "../gcal-outbox-cleanup-rules";

function job(overrides: Partial<OutboxJobCandidate>): OutboxJobCandidate {
  return {
    id: "job-1",
    entityType: "workout",
    entityId: "w-1",
    entityExists: true,
    planStatus: "active",
    ...overrides,
  };
}

describe("cancelReason / isCancellable", () => {
  it("never selects a job whose entity belongs to the active plan", () => {
    const j = job({ planStatus: "active" });
    expect(cancelReason(j)).toBeNull();
    expect(isCancellable(j)).toBe(false);
  });

  it("cancels a job whose plan is archived", () => {
    const j = job({ planStatus: "archived" });
    expect(cancelReason(j)).toBe("archived_plan");
    expect(isCancellable(j)).toBe(true);
  });

  it("cancels a job whose entity row no longer exists", () => {
    const j = job({ entityExists: false, planStatus: null });
    expect(cancelReason(j)).toBe("orphan_entity");
    expect(isCancellable(j)).toBe(true);
  });

  it("orphan check wins even if a stale planStatus is somehow archived", () => {
    // entityExists false should never happen alongside a real planStatus,
    // but the predicate must still treat "gone" as gone regardless.
    const j = job({ entityExists: false, planStatus: "archived" });
    expect(cancelReason(j)).toBe("orphan_entity");
  });

  it("never cancels a standalone strength session with no plan link", () => {
    const j = job({
      entityType: "strength_session",
      entityExists: true,
      planStatus: null,
    });
    expect(cancelReason(j)).toBeNull();
    expect(isCancellable(j)).toBe(false);
  });

  it("cancels a strength session whose linked plan is archived", () => {
    const j = job({
      entityType: "strength_session",
      entityExists: true,
      planStatus: "archived",
    });
    expect(cancelReason(j)).toBe("archived_plan");
  });
});

describe("selectCancellableJobs", () => {
  it("filters a mixed batch down to only the cancellable jobs", () => {
    const jobs: OutboxJobCandidate[] = [
      job({ id: "active", planStatus: "active" }),
      job({ id: "archived", planStatus: "archived" }),
      job({ id: "orphan", entityExists: false, planStatus: null }),
      job({
        id: "standalone-strength",
        entityType: "strength_session",
        planStatus: null,
      }),
    ];
    expect(selectCancellableJobs(jobs).map((j) => j.id)).toEqual(["archived", "orphan"]);
  });

  it("returns an empty list when every job is still valid", () => {
    const jobs: OutboxJobCandidate[] = [
      job({ id: "a", planStatus: "active" }),
      job({ id: "b", entityType: "strength_session", planStatus: null }),
    ];
    expect(selectCancellableJobs(jobs)).toEqual([]);
  });
});
