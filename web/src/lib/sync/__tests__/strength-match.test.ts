import { describe, expect, it } from "vitest";
import {
  pickStrengthSessionMatch,
  STRENGTH_MATCH_TOLERANCE_MS,
  type StrengthSessionCandidate,
} from "../strength-match";

// Activity recorded 18:00–18:50 local time.
const ACTIVITY_START = new Date("2026-07-20T18:00:00Z");
const ACTIVITY_END = new Date("2026-07-20T18:50:00Z");
const activityWindow = { start: ACTIVITY_START, end: ACTIVITY_END };

function candidate(
  id: string,
  setsWindow: StrengthSessionCandidate["setsWindow"]
): StrengthSessionCandidate {
  return { id, status: "planned", setsWindow };
}

describe("pickStrengthSessionMatch", () => {
  it("links a session whose set span cleanly overlaps the activity window", () => {
    const session = candidate("s1", {
      start: new Date("2026-07-20T18:05:00Z"),
      end: new Date("2026-07-20T18:45:00Z"),
    });
    expect(pickStrengthSessionMatch(activityWindow, [session])).toBe("s1");
  });

  it("does not link a session an hour away, even as the sole candidate", () => {
    const session = candidate("s1", {
      start: new Date("2026-07-20T19:55:00Z"),
      end: new Date("2026-07-20T20:35:00Z"),
    });
    expect(pickStrengthSessionMatch(activityWindow, [session])).toBeNull();
  });

  it("links neither when two candidates overlap equally well", () => {
    const s1 = candidate("s1", {
      start: new Date("2026-07-20T18:05:00Z"),
      end: new Date("2026-07-20T18:25:00Z"),
    });
    const s2 = candidate("s2", {
      start: new Date("2026-07-20T18:25:00Z"),
      end: new Date("2026-07-20T18:45:00Z"),
    });
    // Both intervals intersect the activity window by exactly 20 minutes.
    expect(pickStrengthSessionMatch(activityWindow, [s1, s2])).toBeNull();
  });

  it("picks the clearly-better overlap when candidates differ", () => {
    const good = candidate("good", {
      start: new Date("2026-07-20T18:05:00Z"),
      end: new Date("2026-07-20T18:45:00Z"),
    });
    // 10 minutes past the activity's end — inside tolerance, but a much
    // smaller overlap than `good`'s clean 40-minute intersection.
    const weaker = candidate("weaker", {
      start: new Date("2026-07-20T19:00:00Z"),
      end: new Date("2026-07-20T19:10:00Z"),
    });
    expect(pickStrengthSessionMatch(activityWindow, [good, weaker])).toBe("good");
  });

  it("falls back to the sole candidate when no sets are logged yet", () => {
    const notStarted = candidate("s1", null);
    expect(pickStrengthSessionMatch(activityWindow, [notStarted])).toBe("s1");
  });

  it("refuses to guess between several sessions with nothing logged yet", () => {
    const a = candidate("a", null);
    const b = candidate("b", null);
    expect(pickStrengthSessionMatch(activityWindow, [a, b])).toBeNull();
  });

  it("returns null with no candidates", () => {
    expect(pickStrengthSessionMatch(activityWindow, [])).toBeNull();
  });

  it("respects a custom tolerance", () => {
    const session = candidate("s1", {
      start: new Date("2026-07-20T19:05:00Z"),
      end: new Date("2026-07-20T19:10:00Z"),
    });
    // 15 minute gap from the activity's end — outside a 5 minute tolerance...
    expect(pickStrengthSessionMatch(activityWindow, [session], 5 * 60 * 1000)).toBeNull();
    // ...but inside the default 20 minute one.
    expect(pickStrengthSessionMatch(activityWindow, [session], STRENGTH_MATCH_TOLERANCE_MS)).toBe(
      "s1"
    );
  });
});
