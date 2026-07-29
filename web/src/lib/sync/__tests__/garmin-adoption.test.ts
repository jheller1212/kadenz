import { describe, expect, it } from "vitest";
import {
  claimAdoptionCandidate,
  resolveGarminWorkoutId,
  type AdoptionContext,
} from "../garmin-adoption";

// ── Two create jobs, one candidate ───────────────────────────────────────────
// The bug this covers: without claiming, two create jobs in the same drain
// that build the identical (title, scheduledDate) would both match the SAME
// leftover Garmin workout and both local rows would end up pointing at one
// Garmin id — a worse, silent failure than the duplicate the adoption
// mechanism exists to prevent (two rows sharing one remote workout instead
// of one row missing its id).

function makeContext(): AdoptionContext {
  return {
    listing: [
      {
        garminWorkoutId: "111",
        name: "W3 · Easy Run 10km",
        description: null,
        createdByKadenz: true,
        sportType: "running",
        scheduledDates: ["2026-08-03"],
      },
    ],
    trackedIds: new Set(),
    isPartial: false,
  };
}

describe("claimAdoptionCandidate", () => {
  it("claims the candidate on the first call and refuses it on the second", () => {
    const adoption = makeContext();

    const first = claimAdoptionCandidate(adoption, "W3 · Easy Run 10km", "2026-08-03");
    expect(first).toBe("111");
    expect(adoption.trackedIds.has("111")).toBe(true);

    // Second create job in the same drain, same title/date — the id is now
    // tracked, so this must NOT return it again.
    const second = claimAdoptionCandidate(adoption, "W3 · Easy Run 10km", "2026-08-03");
    expect(second).toBeNull();
  });
});

describe("resolveGarminWorkoutId", () => {
  it("adopts for the first job, falls through to create for a second job with the same key", async () => {
    const adoption = makeContext();
    let createCalls = 0;
    const create = async () => {
      createCalls++;
      return `fresh-${createCalls}`;
    };

    const firstId = await resolveGarminWorkoutId(adoption, "W3 · Easy Run 10km", "2026-08-03", create);
    expect(firstId).toBe("111"); // adopted, no create call
    expect(createCalls).toBe(0);

    const secondId = await resolveGarminWorkoutId(adoption, "W3 · Easy Run 10km", "2026-08-03", create);
    expect(secondId).toBe("fresh-1"); // candidate already claimed, so this creates
    expect(createCalls).toBe(1);

    // Both ids end up tracked so a hypothetical third job can't adopt either.
    expect(adoption.trackedIds.has("111")).toBe(true);
    expect(adoption.trackedIds.has("fresh-1")).toBe(true);
  });

  it("creates directly when there is no adoption context (no create jobs this drain otherwise)", async () => {
    const create = async () => "new-id";
    const id = await resolveGarminWorkoutId(null, "Anything", "2026-08-03", create);
    expect(id).toBe("new-id");
  });
});
