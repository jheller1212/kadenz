import { describe, expect, it } from "vitest";
import {
  clearsAutoScheduled,
  computeTopUpPlacements,
  dateFromDayKey,
  isPrunable,
  twinAbsorptionUpdate,
  weekKeyOf,
  weekBudgetFor,
} from "../reconcile";
import type { PlacementDay } from "../schedule-place";
import type { StrengthSessionType } from "../types";

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
    expect(isPrunable({ date: future, status: "planned", autoScheduled: true }, today)).toBe(true);
  });

  it("keeps today's session in scope (date >= today)", () => {
    expect(isPrunable({ date: today, status: "planned", autoScheduled: true }, today)).toBe(true);
  });

  it("never prunes past sessions", () => {
    expect(isPrunable({ date: past, status: "planned", autoScheduled: true }, today)).toBe(false);
  });

  it("never prunes completed / skipped / missed sessions", () => {
    for (const status of ["completed", "skipped", "missed"]) {
      expect(isPrunable({ date: future, status, autoScheduled: true }, today)).toBe(false);
    }
  });

  it("never prunes hand-touched sessions (autoScheduled=false)", () => {
    expect(isPrunable({ date: future, status: "planned", autoScheduled: false }, today)).toBe(false);
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
    const twin = { date: dateFromDayKey("2026-07-18"), status: "skipped", autoScheduled: true };
    expect(isPrunable(twin, today)).toBe(false);
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
