import { describe, expect, it } from "vitest";
import { actualPaceSecKm } from "../units";

// Regression: the Today screen showed a completed run's planned target pace
// instead of its achieved pace (production case: 11.0223 km in 59:57, synced
// via Garmin, actualDurationSeconds left null because that field is only
// populated by the in-app guided runner — see schema.ts comment on
// workouts.actualDurationSeconds). actualPaceSecKm() is the single place
// every screen should ask "what pace did this workout actually run at".
describe("actualPaceSecKm", () => {
  it("prefers the linked activity's measured avg pace over anything derived", () => {
    const pace = actualPaceSecKm({
      actualKm: 11.0223,
      actualDurationSeconds: null,
      activity: { avgPaceSecKm: 326 },
    });
    expect(pace).toBe(326);
  });

  it("derives pace from actualKm/actualDurationSeconds for a guided run with no linked activity", () => {
    // 3597s / 11.0223km — the production numbers, matches formatPace's 5:26/km test.
    const pace = actualPaceSecKm({ actualKm: 11.0223, actualDurationSeconds: 3597, activity: null });
    expect(pace).toBeCloseTo(326.34, 1);
  });

  it("returns null when neither an activity nor a full actual distance+duration pair exists yet", () => {
    expect(actualPaceSecKm({ actualKm: null, actualDurationSeconds: null, activity: null })).toBeNull();
    // Distance synced but no duration yet (e.g. mid-sync) — never divide by zero or fabricate a pace.
    expect(actualPaceSecKm({ actualKm: 11, actualDurationSeconds: null, activity: null })).toBeNull();
    expect(actualPaceSecKm({ actualKm: 0, actualDurationSeconds: 3597, activity: null })).toBeNull();
  });
});
