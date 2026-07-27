import { describe, expect, it } from "vitest";
import { selectDueReminders, type ReminderCandidate, type ReminderSelectionSettings } from "../due";

const SETTINGS: ReminderSelectionSettings = {
  enabled: true,
  leadMinutes: 30,
  defaultTimeOfDay: "07:00",
};

// 08:00 Amsterdam on 20 July 2026 (CEST, UTC+2) is 06:00 UTC.
const WORKOUT_START_UTC = "2026-07-20T06:00:00.000Z";

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    workoutId: "w1",
    dateKey: "2026-07-20",
    timeOfDay: "08:00",
    status: "planned",
    ...overrides,
  };
}

describe("selectDueReminders", () => {
  it("is due once now enters the lead window before the workout starts", () => {
    const now = new Date("2026-07-20T05:35:00.000Z"); // 25 min before start
    const due = selectDueReminders(now, [candidate()], SETTINGS, new Set());
    expect(due).toHaveLength(1);
    expect(due[0].workoutId).toBe("w1");
    expect(due[0].scheduledAt.toISOString()).toBe(WORKOUT_START_UTC);
  });

  it("is not due before the lead window opens", () => {
    const now = new Date("2026-07-20T05:00:00.000Z"); // 60 min before start, lead is 30
    const due = selectDueReminders(now, [candidate()], SETTINGS, new Set());
    expect(due).toHaveLength(0);
  });

  it("is not due once the workout has already started", () => {
    const now = new Date("2026-07-20T06:00:01.000Z");
    const due = selectDueReminders(now, [candidate()], SETTINGS, new Set());
    expect(due).toHaveLength(0);
  });

  it("does not send a stale burst for workouts hours past their start after a long cron outage", () => {
    // A 15-minute GitHub Actions schedule can be down for hours (runner
    // outage, secret rotation, etc). When it comes back, `now` may be far
    // past several workouts' start times at once — none of those should
    // fire late, only the (if any) still-open window should.
    const now = new Date("2026-07-20T10:00:00.000Z"); // 12:00 Amsterdam (CEST), 4h after the 08:00 start
    const candidates = [
      candidate({ workoutId: "missed-by-hours" }), // starts 08:00 local, long gone
      candidate({ workoutId: "missed-by-minutes", dateKey: "2026-07-20", timeOfDay: "11:55" }), // started 5 min ago
      candidate({ workoutId: "still-open", dateKey: "2026-07-20", timeOfDay: "12:15" }), // window open now
      candidate({ workoutId: "not-yet", dateKey: "2026-07-20", timeOfDay: "16:00" }), // window not open yet
    ];
    const due = selectDueReminders(now, candidates, SETTINGS, new Set());
    expect(due.map((d) => d.workoutId)).toEqual(["still-open"]);
  });

  it("skips a workout that's already been marked completed", () => {
    const now = new Date("2026-07-20T05:35:00.000Z");
    const due = selectDueReminders(now, [candidate({ status: "completed" })], SETTINGS, new Set());
    expect(due).toHaveLength(0);
  });

  it("skips a workout that's been skipped", () => {
    const now = new Date("2026-07-20T05:35:00.000Z");
    const due = selectDueReminders(now, [candidate({ status: "skipped" })], SETTINGS, new Set());
    expect(due).toHaveLength(0);
  });

  it("skips a workout whose reminder was already sent", () => {
    const now = new Date("2026-07-20T05:35:00.000Z");
    const due = selectDueReminders(now, [candidate()], SETTINGS, new Set(["w1"]));
    expect(due).toHaveLength(0);
  });

  it("falls back to the default time of day when none is set on the workout", () => {
    // Default 07:00 Amsterdam (CEST) = 05:00 UTC.
    const now = new Date("2026-07-20T04:35:00.000Z");
    const due = selectDueReminders(
      now,
      [candidate({ timeOfDay: null })],
      SETTINGS,
      new Set()
    );
    expect(due).toHaveLength(1);
    expect(due[0].scheduledAt.toISOString()).toBe("2026-07-20T05:00:00.000Z");
  });

  it("does nothing at all when reminders are disabled", () => {
    const now = new Date("2026-07-20T05:35:00.000Z");
    const due = selectDueReminders(now, [candidate()], { ...SETTINGS, enabled: false }, new Set());
    expect(due).toHaveLength(0);
  });

  it("handles winter time (CET, UTC+1) correctly", () => {
    // 08:00 Amsterdam on 15 Jan (CET, UTC+1) is 07:00 UTC.
    const winterCandidate = candidate({ dateKey: "2026-01-15" });
    const now = new Date("2026-01-15T06:35:00.000Z"); // 25 min before
    const due = selectDueReminders(now, [winterCandidate], SETTINGS, new Set());
    expect(due).toHaveLength(1);
    expect(due[0].scheduledAt.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  it("evaluates multiple candidates independently", () => {
    const now = new Date("2026-07-20T05:35:00.000Z");
    const due = selectDueReminders(
      now,
      [
        candidate({ workoutId: "due-one" }),
        candidate({ workoutId: "completed", status: "completed" }),
        candidate({ workoutId: "already-sent" }),
        candidate({ workoutId: "too-early", timeOfDay: "10:00" }),
      ],
      SETTINGS,
      new Set(["already-sent"])
    );
    expect(due.map((d) => d.workoutId)).toEqual(["due-one"]);
  });
});
