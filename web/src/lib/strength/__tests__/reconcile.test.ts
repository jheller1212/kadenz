import { describe, expect, it } from "vitest";
import {
  AUTO_CLOSE_IDLE_MINUTES,
  autoCloseUpdate,
  clearsAutoScheduled,
  computeAchillesRehabDays,
  computeTopUpPlacements,
  dateFromDayKey,
  isAutoCloseDue,
  isPrunable,
  isStaleAdhoc,
  rotationForEmphasis,
  twinAbsorptionUpdate,
  weekKeyOf,
  weekBudgetFor,
} from "../reconcile";
import type { PlacementDay } from "../schedule-place";
import type { StrengthSessionType } from "../types";

// ── Session-type rotation, derived from frequency + goal ─────────────────────
// rotationForEmphasis is the source of truth the old hand-typed ROTATIONS
// table was replaced with — the load-bearing invariant is "never the same
// emphasis twice in a row" (the ~48h-per-muscle-group rule), for every
// frequency and goal it's asked to produce.

describe("rotationForEmphasis", () => {
  const GOALS = ["running_focus", "all_round"];

  it("never repeats the same emphasis on consecutive sessions, for every frequency 1-6 and both goals", () => {
    for (const goal of GOALS) {
      for (let n = 1; n <= 6; n++) {
        const seq = rotationForEmphasis(goal, n);
        expect(seq).toHaveLength(n);
        for (let i = 1; i < seq.length; i++) {
          expect(seq[i]).not.toBe(seq[i - 1]);
        }
      }
    }
  });

  it("running_focus is biased toward lower-body/posterior-chain work", () => {
    for (let n = 1; n <= 6; n++) {
      const seq = rotationForEmphasis("running_focus", n);
      const lowerCount = seq.filter((e) => e === "lower").length;
      const upperCount = seq.filter((e) => e === "upper").length;
      expect(lowerCount).toBeGreaterThanOrEqual(upperCount);
    }
  });

  it("frequency 4 is a clean lower/upper alternation for a balanced goal", () => {
    expect(rotationForEmphasis("all_round", 4)).toEqual(["lower", "upper", "lower", "upper"]);
  });

  it("frequency 0 returns an empty sequence", () => {
    expect(rotationForEmphasis("all_round", 0)).toEqual([]);
  });

  it("clamps above 6 rather than growing without bound", () => {
    expect(rotationForEmphasis("all_round", 10)).toHaveLength(6);
  });
});

// ── Day/week key math ────────────────────────────────────────────────────────

describe("weekKeyOf", () => {
  it("maps every day of a week to its Monday", () => {
    // 2026-07-20 is a Monday.
    expect(weekKeyOf("2026-07-20")).toBe("2026-07-20");
    expect(weekKeyOf("2026-07-22")).toBe("2026-07-20"); // Wed
    expect(weekKeyOf("2026-07-26")).toBe("2026-07-20"); // Sun
    expect(weekKeyOf("2026-07-27")).toBe("2026-07-27"); // next Mon
    expect(weekKeyOf("2026-07-19")).toBe("2026-07-13"); // prev Sun
  });

  it("crosses month boundaries", () => {
    expect(weekKeyOf("2026-08-01")).toBe("2026-07-27");
  });
});

// ── Prune selection ──────────────────────────────────────────────────────────

describe("isPrunable", () => {
  const today = dateFromDayKey("2026-07-18");
  const future = dateFromDayKey("2026-07-20");
  const past = dateFromDayKey("2026-07-10");

  it("selects future planned auto-scheduled sessions", () => {
    expect(
      isPrunable({ date: future, status: "planned", autoScheduled: true, hasLoggedData: false }, today)
    ).toBe(true);
  });

  it("keeps today's session in scope (date >= today)", () => {
    expect(
      isPrunable({ date: today, status: "planned", autoScheduled: true, hasLoggedData: false }, today)
    ).toBe(true);
  });

  it("never prunes past sessions", () => {
    expect(
      isPrunable({ date: past, status: "planned", autoScheduled: true, hasLoggedData: false }, today)
    ).toBe(false);
  });

  it("never prunes completed / skipped / missed sessions", () => {
    for (const status of ["completed", "skipped", "missed"]) {
      expect(
        isPrunable({ date: future, status, autoScheduled: true, hasLoggedData: false }, today)
      ).toBe(false);
    }
  });

  it("never prunes hand-touched sessions (autoScheduled=false)", () => {
    expect(
      isPrunable({ date: future, status: "planned", autoScheduled: false, hasLoggedData: false }, today)
    ).toBe(false);
  });

  // ── The destructive-delete bug this predicate exists to close ──────────────
  it("never prunes a session with logged sets, even if status/autoScheduled still look untouched", () => {
    // A session an athlete has started logging sets on can still read
    // status="planned", autoScheduled=true — logging a set never flips
    // either flag directly. hasLoggedData is the caller-supplied fact that
    // closes that gap; without it this would wrongly return true.
    expect(
      isPrunable({ date: today, status: "planned", autoScheduled: true, hasLoggedData: true }, today)
    ).toBe(false);
    expect(
      isPrunable({ date: future, status: "planned", autoScheduled: true, hasLoggedData: true }, today)
    ).toBe(false);
  });

  it("still prunes a genuinely untouched future auto-scheduled session", () => {
    expect(
      isPrunable({ date: future, status: "planned", autoScheduled: true, hasLoggedData: false }, today)
    ).toBe(true);
  });
});

// ── Stale ad-hoc sweep selection ────────────────────────────────────────────

describe("isStaleAdhoc", () => {
  const today = dateFromDayKey("2026-07-18");
  const yesterday = dateFromDayKey("2026-07-17");
  const future = dateFromDayKey("2026-07-20");

  it("selects a past, untouched, non-plan session", () => {
    expect(
      isStaleAdhoc(
        { date: yesterday, status: "planned", watchEligible: false, hasLoggedData: false },
        today
      )
    ).toBe(true);
  });

  it("never touches today's session — might still be mid-workout", () => {
    expect(
      isStaleAdhoc(
        { date: today, status: "planned", watchEligible: false, hasLoggedData: false },
        today
      )
    ).toBe(false);
  });

  it("never touches a future session", () => {
    expect(
      isStaleAdhoc(
        { date: future, status: "planned", watchEligible: false, hasLoggedData: false },
        today
      )
    ).toBe(false);
  });

  it("never touches a watchEligible (plan) session, even if past and untouched — that's a missed training day, not a throwaway", () => {
    expect(
      isStaleAdhoc(
        { date: yesterday, status: "planned", watchEligible: true, hasLoggedData: false },
        today
      )
    ).toBe(false);
  });

  it("never touches a session with logged data", () => {
    expect(
      isStaleAdhoc(
        { date: yesterday, status: "planned", watchEligible: false, hasLoggedData: true },
        today
      )
    ).toBe(false);
  });

  it("never touches completed / skipped / missed sessions", () => {
    for (const status of ["completed", "skipped", "missed"]) {
      expect(
        isStaleAdhoc({ date: yesterday, status, watchEligible: false, hasLoggedData: false }, today)
      ).toBe(false);
    }
  });
});

// ── PATCH adoption semantics ─────────────────────────────────────────────────

describe("clearsAutoScheduled", () => {
  it("bare status ticks do NOT adopt the session", () => {
    expect(clearsAutoScheduled({ status: "completed" })).toBe(false);
    expect(clearsAutoScheduled({ status: "planned" })).toBe(false); // untick
    expect(clearsAutoScheduled({ status: "skipped" })).toBe(false);
    expect(clearsAutoScheduled({})).toBe(false);
  });

  it("meaningful edits adopt the session", () => {
    expect(clearsAutoScheduled({ date: "2026-07-21T12:00:00Z" })).toBe(true);
    expect(clearsAutoScheduled({ notes: "felt strong" })).toBe(true);
    expect(clearsAutoScheduled({ sortOrder: 2 })).toBe(true);
    expect(clearsAutoScheduled({ durationMinutes: 45 })).toBe(true);
  });

  it("status combined with a meaningful edit still adopts", () => {
    expect(clearsAutoScheduled({ status: "completed", durationMinutes: 40 })).toBe(true);
  });
});

// ── Twin absorption on completion ────────────────────────────────────────────

describe("twinAbsorptionUpdate", () => {
  it("marks the twin skipped, never deletes it", () => {
    const now = dateFromDayKey("2026-07-21");
    const update = twinAbsorptionUpdate(now);
    expect(update.status).toBe("skipped");
    expect(update.updatedAt).toBe(now);
    // No key here should ever be a delete-style signal — the twin survives
    // as a real, queryable row.
    expect(Object.keys(update).sort()).toEqual(["status", "updatedAt"]);
  });

  it("a skipped twin is never prunable, same as before", () => {
    const today = dateFromDayKey("2026-07-18");
    const twin = {
      date: dateFromDayKey("2026-07-18"),
      status: "skipped",
      autoScheduled: true,
      hasLoggedData: false,
    };
    expect(isPrunable(twin, today)).toBe(false);
  });
});

// ── Auto-close (abandoned in-progress sessions) ──────────────────────────────

describe("isAutoCloseDue", () => {
  const start = new Date("2026-07-20T18:00:00Z");
  const lastSet = new Date("2026-07-20T18:20:00Z"); // 20 min into the workout

  it("is not due before the idle threshold elapses", () => {
    const now = new Date(lastSet.getTime() + (AUTO_CLOSE_IDLE_MINUTES - 1) * 60_000);
    expect(isAutoCloseDue({ status: "planned", startedAt: start, endedAt: lastSet }, now)).toBe(false);
  });

  it("is due exactly at the idle threshold boundary", () => {
    const now = new Date(lastSet.getTime() + AUTO_CLOSE_IDLE_MINUTES * 60_000);
    expect(isAutoCloseDue({ status: "planned", startedAt: start, endedAt: lastSet }, now)).toBe(true);
  });

  it("is due well past the idle threshold", () => {
    const now = new Date(lastSet.getTime() + 2 * AUTO_CLOSE_IDLE_MINUTES * 60_000);
    expect(isAutoCloseDue({ status: "planned", startedAt: start, endedAt: lastSet }, now)).toBe(true);
  });

  it("a genuine rest/pause under the threshold is never touched", () => {
    // A phone-call-length pause (15 min) must not trip the sweep.
    const now = new Date(lastSet.getTime() + 15 * 60_000);
    expect(isAutoCloseDue({ status: "planned", startedAt: start, endedAt: lastSet }, now)).toBe(false);
  });

  it("never touches a session with no logged sets (no startedAt/endedAt)", () => {
    const now = new Date(start.getTime() + 10 * AUTO_CLOSE_IDLE_MINUTES * 60_000);
    expect(isAutoCloseDue({ status: "planned", startedAt: null, endedAt: null }, now)).toBe(false);
  });

  it("never touches a session that already reached a terminal status", () => {
    const now = new Date(lastSet.getTime() + 10 * AUTO_CLOSE_IDLE_MINUTES * 60_000);
    for (const status of ["completed", "skipped", "missed"]) {
      expect(isAutoCloseDue({ status, startedAt: start, endedAt: lastSet }, now)).toBe(false);
    }
  });
});

describe("autoCloseUpdate", () => {
  it("lands on completed with a duration derived from the real set timestamps", () => {
    const start = new Date("2026-07-20T18:00:00Z");
    const lastSet = new Date("2026-07-20T18:42:00Z");
    const now = new Date("2026-07-20T19:30:00Z");
    const update = autoCloseUpdate({ startedAt: start, endedAt: lastSet }, now);
    expect(update.status).toBe("completed");
    expect(update.durationMinutes).toBe(42);
    expect(update.updatedAt).toBe(now);
  });

  it("never produces a zero/negative duration for a same-timestamp single-set session", () => {
    const t = new Date("2026-07-20T18:00:00Z");
    const update = autoCloseUpdate({ startedAt: t, endedAt: t }, new Date(t.getTime() + 60_000));
    expect(update.durationMinutes).toBe(1);
  });
});

// ── Top-up caps ──────────────────────────────────────────────────────────────

const ALL_DOWS = [0, 1, 2, 3, 4, 5, 6];

/** Rest-day strip from startKey (inclusive), n days, honest dow per date. */
function strip(startKey: string, n: number, takenKeys: string[] = []): PlacementDay[] {
  const days: PlacementDay[] = [];
  const d = dateFromDayKey(startKey);
  for (let i = 0; i < n; i++) {
    const key = d.toISOString().slice(0, 10);
    days.push({
      key,
      dow: d.getUTCDay(),
      runType: null,
      nextDayRunType: null,
      taken: takenKeys.includes(key),
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

const ROTATION: StrengthSessionType[] = ["lower_achilles", "full_body"];

describe("computeTopUpPlacements", () => {
  it("places a full rotation per empty calendar week", () => {
    // Mon 20 → Sun 26 + Mon 27 → Sun 02: two full weeks.
    const placed = computeTopUpPlacements(strip("2026-07-20", 14), ROTATION, ALL_DOWS, new Map());
    const byWeek = new Map<string, number>();
    for (const p of placed) {
      const wk = weekKeyOf(p.key);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
    }
    expect(byWeek.get("2026-07-20")).toBe(2);
    expect(byWeek.get("2026-07-27")).toBe(2);
  });

  it("never places on a day that already has ANY session", () => {
    const taken = ["2026-07-21", "2026-07-23"];
    const placed = computeTopUpPlacements(
      strip("2026-07-20", 7, taken),
      ROTATION,
      ALL_DOWS,
      new Map([["2026-07-20", 2]]) // the taken days count toward the week too
    );
    for (const p of placed) expect(taken).not.toContain(p.key);
  });

  it("never exceeds the rotation length per calendar week (existing sessions count)", () => {
    // One existing session this week (e.g. completed Tue) → only one slot left.
    const placed = computeTopUpPlacements(
      strip("2026-07-20", 7, ["2026-07-21"]),
      ROTATION,
      ALL_DOWS,
      new Map([["2026-07-20", 1]])
    );
    expect(placed.length).toBe(1);
  });

  it("counts sessions from BEFORE the strip in a leading partial week", () => {
    // Today is Fri 24; strip starts Sat 25. Mon–Wed already hold 2 sessions
    // (completed, not visible as strip days). Week budget is exhausted.
    const leading = strip("2026-07-25", 2); // Sat 25, Sun 26
    const nextWeek = strip("2026-07-27", 7);
    const placed = computeTopUpPlacements(
      [...leading, ...nextWeek],
      ROTATION,
      ALL_DOWS,
      new Map([["2026-07-20", 2]])
    );
    // Nothing in the leading partial week; next week gets its full rotation.
    expect(placed.filter((p) => weekKeyOf(p.key) === "2026-07-20")).toHaveLength(0);
    expect(placed.filter((p) => weekKeyOf(p.key) === "2026-07-27")).toHaveLength(2);
  });

  it("over-full weeks (count beyond rotation) place nothing and don't underflow", () => {
    const placed = computeTopUpPlacements(
      strip("2026-07-20", 7),
      ROTATION,
      ALL_DOWS,
      new Map([["2026-07-20", 7]]) // the prod mess: 7 sessions in one week
    );
    expect(placed).toHaveLength(0);
  });

  it("tops up the remainder when a week is partially filled", () => {
    const rotation3: StrengthSessionType[] = ["lower_achilles", "full_body", "achilles"];
    const placed = computeTopUpPlacements(
      strip("2026-07-20", 7, ["2026-07-20"]),
      rotation3,
      ALL_DOWS,
      new Map([["2026-07-20", 1]])
    );
    expect(placed.length).toBeLessThanOrEqual(2);
    expect(placed.length).toBeGreaterThan(0);
    // Per-day invariant holds alongside the weekly cap.
    expect(placed.map((p) => p.key)).not.toContain("2026-07-20");
  });
});

describe("computeTopUpPlacements — per-week budget", () => {
  const rotation: StrengthSessionType[] = ["upper", "lower", "full_body"];
  const availableDays = [1, 2, 3, 4, 5, 6, 0];

  function week(mondayIso: string): PlacementDay[] {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${mondayIso}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { key, dow: d.getUTCDay(), runType: null, nextDayRunType: null, taken: false };
    });
  }

  it("schedules the full rotation in a normal week", () => {
    const out = computeTopUpPlacements(week("2026-08-03"), rotation, availableDays, new Map());
    expect(out).toHaveLength(3);
  });

  it("schedules nothing in race week", () => {
    const out = computeTopUpPlacements(
      week("2026-08-03"),
      rotation,
      availableDays,
      new Map(),
      () => 0
    );
    expect(out).toHaveLength(0);
  });

  it("thins a deload week by one session", () => {
    const out = computeTopUpPlacements(
      week("2026-08-03"),
      rotation,
      availableDays,
      new Map(),
      (_k, len) => Math.max(1, len - 1)
    );
    expect(out).toHaveLength(2);
  });

  it("never exceeds the rotation even with a generous budget", () => {
    const out = computeTopUpPlacements(
      week("2026-08-03"),
      rotation,
      availableDays,
      new Map(),
      () => 99
    );
    expect(out).toHaveLength(3);
  });

  it("counts sessions already scheduled that week against the budget", () => {
    const already = new Map([["2026-08-03", 1]]);
    const out = computeTopUpPlacements(
      week("2026-08-03"),
      rotation,
      availableDays,
      already,
      (_k, len) => Math.max(1, len - 1)
    );
    expect(out).toHaveLength(1);
  });
});

describe("weekBudgetFor", () => {
  it("gives base and build weeks the full rotation", () => {
    expect(weekBudgetFor({ type: "normal", phase: "base" }, 4)).toBe(4);
    expect(weekBudgetFor({ type: "normal", phase: "build" }, 4)).toBe(4);
  });

  it("backs off in peak weeks — running volume is highest then", () => {
    expect(weekBudgetFor({ type: "normal", phase: "peak" }, 4)).toBe(3);
  });

  it("backs off in taper and deload weeks", () => {
    expect(weekBudgetFor({ type: "normal", phase: "taper" }, 4)).toBe(3);
    expect(weekBudgetFor({ type: "deload", phase: "build" }, 4)).toBe(3);
  });

  it("schedules nothing in race week", () => {
    expect(weekBudgetFor({ type: "race", phase: "taper" }, 4)).toBe(0);
  });

  it("never drops a one-session-per-week plan to zero", () => {
    expect(weekBudgetFor({ type: "deload", phase: "peak" }, 1)).toBe(1);
  });

  it("falls back to the full rotation outside a plan", () => {
    expect(weekBudgetFor(undefined, 3)).toBe(3);
  });
});

// ── Regression: Jonas's live configuration ───────────────────────────────────
// Reported from production: a 13-week half marathon plan with runs on every
// weekday (Mon-Fri), strength set to 4 sessions/week on Mon-Fri. "Fit it
// around the new plan" produced 2 sessions total, both in week 1, and zero
// for the remaining 12 weeks. The root cause was that the DB route calling
// this (POST /api/plans) fired reconcileStrengthSchedule() without awaiting
// it — a serverless invocation is free to freeze right after the response is
// sent, and the reconcile inserts one row per placement in calendar order, so
// a freeze mid-loop stops after the first couple of rows. That's fixed at the
// route by awaiting the call; this test instead locks down the pure planner
// half of the bug surface: given the exact rotation/availability/run-day
// shape from his account, top-up must place sessions across the WHOLE plan,
// not just the opening days of week 1.
describe("computeTopUpPlacements — 13-week plan, runs on every weekday", () => {
  const rotation: StrengthSessionType[] = ["lower", "full_body", "lower", "upper"];
  const availableDays = [1, 2, 3, 4, 5]; // Mon-Fri, matches the strength settings

  // Week type per phase, mirroring a real half-marathon plan generated for
  // this configuration (base -> build -> peak -> taper/race, deload every
  // 4th week).
  const weekPlan: { type: string; phase: string; runTypes: (string | null)[] }[] = [
    { type: "normal", phase: "base", runTypes: ["easy", "easy", "easy", "easy", "long", null, null] },
    { type: "normal", phase: "base", runTypes: ["easy", "easy", "easy", "easy", "long", null, null] },
    { type: "normal", phase: "base", runTypes: ["easy", "easy", "easy", "easy", "long", null, null] },
    { type: "deload", phase: "base", runTypes: ["easy", "easy", "easy", "easy", "long", null, null] },
    { type: "normal", phase: "build", runTypes: ["tempo", "easy", "interval", "easy", "long", null, null] },
    { type: "normal", phase: "build", runTypes: ["tempo", "easy", "interval", "easy", "long", null, null] },
    { type: "normal", phase: "build", runTypes: ["tempo", "easy", "interval", "easy", "long", null, null] },
    { type: "deload", phase: "build", runTypes: ["tempo", "easy", "interval", "easy", "long", null, null] },
    { type: "normal", phase: "build", runTypes: ["tempo", "easy", "interval", "easy", "long", null, null] },
    { type: "normal", phase: "peak", runTypes: ["interval", "tempo", "easy", "easy", "long", null, null] },
    { type: "normal", phase: "peak", runTypes: ["interval", "tempo", "easy", "easy", "long", null, null] },
    { type: "deload", phase: "peak", runTypes: ["interval", "tempo", "easy", "easy", "long", null, null] },
    { type: "race", phase: "taper", runTypes: ["easy", "easy", "easy", null, "race", null, null] },
  ];

  function buildStrip(): (PlacementDay & { weekKey: string })[] {
    const strip: (PlacementDay & { weekKey: string })[] = [];
    let monday = dateFromDayKey("2026-07-27");
    for (const w of weekPlan) {
      const weekKey = weekKeyOf(monday.toISOString().slice(0, 10));
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setUTCDate(d.getUTCDate() + i);
        const key = d.toISOString().slice(0, 10);
        const runType = w.runTypes[i];
        const nextRunType = i < 6 ? w.runTypes[i + 1] : null; // approx, ignores week boundary
        strip.push({
          key,
          weekKey,
          dow: d.getUTCDay(),
          runType,
          nextDayRunType: nextRunType,
          taken: false,
        });
      }
      monday = new Date(monday);
      monday.setUTCDate(monday.getUTCDate() + 7);
    }
    return strip;
  }

  it("places sessions across every non-race week, not just week 1", () => {
    const strip = buildStrip();
    // weekKey ("Monday" date string) -> {type, phase}, one entry per week in
    // weekPlan, walking the same Mondays buildStrip used.
    const weekTypeByKey = new Map<string, { type: string; phase: string }>();
    let monday = dateFromDayKey("2026-07-27");
    for (const w of weekPlan) {
      weekTypeByKey.set(weekKeyOf(monday.toISOString().slice(0, 10)), w);
      monday = new Date(monday);
      monday.setUTCDate(monday.getUTCDate() + 7);
    }

    const placements = computeTopUpPlacements(
      strip,
      rotation,
      availableDays,
      new Map(), // nothing pre-existing — a fresh top-up over the whole plan
      (weekKey, rotationLength) => weekBudgetFor(weekTypeByKey.get(weekKey), rotationLength)
    );

    const byWeek = new Map<string, number>();
    for (const p of placements) {
      const wk = weekKeyOf(p.key);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
    }

    const weekKeys = [...weekTypeByKey.keys()];
    // Every week except the zero-budget race week must carry at least one
    // session — this is the exact regression: production showed 2 total,
    // both in week 1, and 0 in weeks 2-13.
    for (let i = 0; i < weekKeys.length - 1; i++) {
      expect(byWeek.get(weekKeys[i]) ?? 0).toBeGreaterThan(0);
    }
    // Race week carries none — that's the intended taper-to-zero, not a bug.
    expect(byWeek.get(weekKeys[weekKeys.length - 1]) ?? 0).toBe(0);

    // The plan should land close to its configured 4/week on the weeks that
    // don't back off for deload/peak/taper (weeks 1-3, 5-7, 9-10 here).
    expect(byWeek.get(weekKeys[0])).toBeGreaterThanOrEqual(3);

    const total = placements.length;
    expect(total).toBeGreaterThan(20); // nowhere near the production total of 2
  });
});

// ── Achilles/HSR rehab day selection ─────────────────────────────────────────
// The scenario this exists to fix, in two acts:
//
//   1. PR #152 made scheduling muscle-group aware, and for an athlete with an
//      achilles complaint that produced 4 consecutive strength days (Mon-Thu),
//      each one carrying the old every-session Achilles/HSR block — the exact
//      back-to-back loading HSR protocols are designed to avoid.
//   2. Scheduling Achilles/HSR work as its own session, restricted to days the
//      strength rotation left free, fixed the consecutive-day problem but
//      created a worse one for an athlete whose strength days fill (or nearly
//      fill) their available week: zero rehab days, because "free" days never
//      existed in the first place.
//
// computeAchillesRehabDays decides the rehab DAYS first, over the athlete's
// whole available week, independent of which days the strength rotation
// claimed — a day already holding a plain upper/lower/full_body session is a
// perfectly good rehab day (the caller attaches the block to it instead of
// creating a second session); only a day that ALREADY carries the block
// (`dayTypes` mapped to an Achilles-carrying type) is skipped.
describe("computeAchillesRehabDays", () => {
  const ALL_DOWS_LOCAL = [0, 1, 2, 3, 4, 5, 6];

  /** dayTypes map from a list of day keys, all mapped to the same type. */
  function typesFor(keys: string[], type: StrengthSessionType): Map<string, StrengthSessionType> {
    return new Map(keys.map((k) => [k, type]));
  }

  it("picks roughly 3 days in an otherwise-empty week", () => {
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7), // Mon 20 -> Sun 26
      new Map(),
      ALL_DOWS_LOCAL,
      new Map()
    );
    expect(days.length).toBe(3);
  });

  it("never picks two consecutive calendar days", () => {
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 21), // three weeks
      new Map(),
      ALL_DOWS_LOCAL,
      new Map()
    );
    const sorted = [...days].sort();
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (dateFromDayKey(sorted[i]).getTime() - dateFromDayKey(sorted[i - 1]).getTime()) /
        (24 * 60 * 60 * 1000);
      expect(gap).toBeGreaterThanOrEqual(2);
    }
  });

  it("freely picks a day that already holds a PLAIN strength session — that's the whole fix", () => {
    // Every day of the week already has a "lower" session. The old
    // free-days-only design would return nothing; the frequency-and-spacing
    // policy must still pick 3, since the caller attaches to a plain day
    // instead of needing it empty.
    const plainEveryDay = typesFor(
      strip("2026-07-20", 7).map((d) => d.key),
      "lower"
    );
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      plainEveryDay,
      ALL_DOWS_LOCAL,
      new Map()
    );
    expect(days.length).toBe(3);
  });

  it("skips a day already covered by an Achilles-carrying type", () => {
    const monday = "2026-07-20";
    const dayTypes = typesFor([monday], "achilles");
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      dayTypes,
      ALL_DOWS_LOCAL,
      new Map()
    );
    expect(days).not.toContain(monday);
  });

  it("respects the athlete's available days", () => {
    const weekdaysOnly = [1, 2, 3, 4, 5];
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      new Map(),
      weekdaysOnly,
      new Map()
    );
    for (const key of days) {
      const dow = dateFromDayKey(key).getUTCDay();
      expect(weekdaysOnly).toContain(dow);
    }
  });

  it("never exceeds the weekly target once existing sessions already count toward it", () => {
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      new Map(),
      ALL_DOWS_LOCAL,
      new Map([["2026-07-20", 2]])
    );
    expect(days.length).toBeLessThanOrEqual(1);
  });

  it("picks nothing once the weekly target is already met", () => {
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      new Map(),
      ALL_DOWS_LOCAL,
      new Map([["2026-07-20", 3]])
    );
    expect(days).toHaveLength(0);
  });

  it("respects spacing against a session placed just before the strip starts", () => {
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      new Map(),
      ALL_DOWS_LOCAL,
      new Map(),
      "2026-07-19"
    );
    expect(days[0]).not.toBe("2026-07-20");
  });

  it("respects a custom weekly target", () => {
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7),
      new Map(),
      ALL_DOWS_LOCAL,
      new Map(),
      null,
      2
    );
    expect(days.length).toBe(2);
  });

  it("does not skip a day only because the strip marks it taken — dayTypes, not strip.taken, is authoritative", () => {
    // A day marked taken but absent from dayTypes (caller's responsibility to
    // keep them consistent) is treated as a free, attachable/standalone day.
    const days = computeAchillesRehabDays(
      strip("2026-07-20", 7, ["2026-07-20"]),
      new Map(), // deliberately not marking 2026-07-20 as occupied
      ALL_DOWS_LOCAL,
      new Map()
    );
    expect(days).toContain("2026-07-20");
  });

  // ── Regression: Jonas's real settings ────────────────────────────────────
  // Runs Mon-Thu easy, Fri rest, Sat long, Sun rest; available_days [1,2,3,4,5]
  // (Mon-Fri); strength rotation (post-#152) lands Mon/Tue/Wed/Thu, filling
  // every available day except Friday. Before this fix, the rehab pass only
  // considered days the strength rotation left free (Fri/Sat/Sun, and Sat/Sun
  // aren't in available_days) — Friday alone was then vetoed as the day
  // before Saturday's long run, using the SAME veto reasoning as heavy-leg
  // strength work. Net result: ZERO rehab sessions, worse than the 4x/week
  // bug this whole change exists to fix.
  //
  // Two fixes combine to resolve it: (1) rehab days are chosen over the whole
  // available week, attaching to an already-strength-day rather than needing
  // it free, and (2) the day-before-a-long-run veto no longer applies to
  // Achilles/HSR work (see schedule-place.ts isHardVeto and the top-of-file
  // comment in constraints.ts: "Calf HSR the day before a long easy run is
  // fine" — that veto was heavy-leg-strength reasoning inherited without
  // justification).
  it("Jonas's real week: 4 strength days Mon-Thu, Mon-Fri availability — still lands 3 rehab exposures", () => {
    const week = strip("2026-07-20", 7).map((d) => {
      // Mon(20)-Thu(23) easy, Fri(24) rest, Sat(25) long, Sun(26) rest.
      const idx = Number(d.key.slice(-2)) - 20; // 0=Mon..6=Sun
      const runType = idx <= 3 ? "easy" : idx === 5 ? "long" : null;
      const nextIdx = idx + 1;
      const nextRunType = nextIdx <= 3 ? "easy" : nextIdx === 5 ? "long" : null;
      return { ...d, runType, nextDayRunType: nextIdx <= 6 ? nextRunType : null };
    });
    const availableDays = [1, 2, 3, 4, 5]; // Mon-Fri

    const strengthDays = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"]; // Mon-Thu
    const dayTypes = typesFor(strengthDays, "lower");

    const rehabDays = computeAchillesRehabDays(week, dayTypes, availableDays, new Map());

    expect(rehabDays.length).toBe(3);
    // None back to back.
    const sorted = [...rehabDays].sort();
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (dateFromDayKey(sorted[i]).getTime() - dateFromDayKey(sorted[i - 1]).getTime()) /
        (24 * 60 * 60 * 1000);
      expect(gap).toBeGreaterThanOrEqual(2);
    }
  });

  it("still respects the interval/hard-run vetoes for Achilles work specifically", () => {
    // Tue (idx1) is an interval day; Achilles work is vetoed same-day
    // (explosive + interval) and the day before (Mon).
    const week = strip("2026-07-20", 7).map((d) => {
      const idx = Number(d.key.slice(-2)) - 20;
      const runType = idx === 1 ? "interval" : null;
      const nextRunType = idx === 0 ? "interval" : null;
      return { ...d, runType, nextDayRunType: nextRunType };
    });
    const days = computeAchillesRehabDays(week, new Map(), ALL_DOWS_LOCAL, new Map());
    expect(days).not.toContain("2026-07-20"); // Monday: day before the interval
    expect(days).not.toContain("2026-07-21"); // Tuesday: the interval day itself
  });
});

describe("computeTopUpPlacements + computeAchillesRehabDays composed", () => {
  const ALL_DOWS_LOCAL = [0, 1, 2, 3, 4, 5, 6];

  it("an attached rehab day is picked from wherever the strength rotation actually landed, not restricted to leftovers", () => {
    const rotation: StrengthSessionType[] = ["lower", "upper", "lower", "full_body"];
    const s = strip("2026-07-20", 7);
    const strengthPlaced = computeTopUpPlacements(s, rotation, ALL_DOWS_LOCAL, new Map());
    expect(strengthPlaced).toHaveLength(4);

    const dayTypes = new Map(strengthPlaced.map((p) => [p.key, p.type]));
    const rehabDays = computeAchillesRehabDays(s, dayTypes, ALL_DOWS_LOCAL, new Map());

    // The rehab pass must still land its target — 3 — composing with a full
    // strength week rather than being starved by it.
    expect(rehabDays.length).toBe(3);
  });
});
