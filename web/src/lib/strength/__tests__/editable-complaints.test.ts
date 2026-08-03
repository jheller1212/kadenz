import { describe, expect, it } from "vitest";
import { buildSessionPlan } from "../session";
import {
  achillesProgramWeek,
  effectiveComplaints,
  isPainTrackedExercise,
} from "../complaint-work";
import { hsrPrescriptionForWeek } from "../program";
import type { Complaint, ExerciseSessionHistory } from "../types";

// Complaints became editable after setup (Kraft settings). These cover the
// four things that had to stay true when one changes: the sessions change,
// turning it back on reinstates the right work, a session with logged sets is
// not rebuilt without the work those sets belong to, and history survives.

const HSR_SLUGS = ["straight_knee_calf_raise", "bent_knee_calf_raise"];

function slugsFor(complaints: Complaint[]) {
  return buildSessionPlan("lower", { complaints }).map((e) => e.slug);
}

describe("removing a complaint changes the session", () => {
  it("a plain 'lower' session never carries the Achilles block, achilles reported or not", () => {
    // Achilles/HSR work is scheduled as its own dedicated "achilles" session
    // now (see reconcile.ts computeAchillesPlacements) — reporting the
    // complaint no longer changes what a plain lower/upper/full_body session
    // contains (see program.ts sessionTemplateFor).
    const withComplaint = slugsFor(["achilles"]);
    const without = slugsFor([]);
    for (const slug of [...HSR_SLUGS, "explosive_box_step_up", "loaded_toe_walk"]) {
      expect(withComplaint).not.toContain(slug);
      expect(without).not.toContain(slug);
    }
    expect(withComplaint).toEqual(without);
  });

  it("drops targeted work for every other complaint too, one at a time", () => {
    const cases: Array<[Complaint, string]> = [
      ["plantar_fascia", "single_leg_calf_raise"],
      ["shin", "tibialis_raise"],
      ["knee", "step_down"],
      ["itb", "side_lying_leg_raise"],
      ["hamstring", "nordic_curl_negative"],
      ["hip_glute", "clamshell"],
    ];
    for (const [complaint, slug] of cases) {
      expect(slugsFor([complaint])).toContain(slug);
      expect(slugsFor([])).not.toContain(slug);
    }
  });

  it("removing one complaint leaves another one's work in place", () => {
    const both = slugsFor(["knee", "hamstring"]);
    expect(both).toContain("step_down");
    expect(both).toContain("nordic_curl_negative");

    const kneeOnly = slugsFor(["knee"]);
    expect(kneeOnly).toContain("step_down");
    expect(kneeOnly).not.toContain("nordic_curl_negative");
  });
});

describe("turning a complaint back on", () => {
  it("reinstates the same work it added before", () => {
    expect(slugsFor(["knee"])).toContain("step_down");
    expect(slugsFor([])).not.toContain("step_down");
  });

  it("restarts the HSR ramp at week 1 rather than resuming it", () => {
    // The ramp counts from when the complaint was reported, so re-reporting
    // today puts the athlete back on the week 1 load however deep into a
    // running plan they are (see complaint-work.ts for why).
    const today = new Date("2026-07-30T12:00:00Z");
    const reReportedToday = achillesProgramWeek(today, today, 14);
    expect(reReportedToday).toBe(1);
    expect(hsrPrescriptionForWeek(reReportedToday).weightKg).toBe(15);
    expect(hsrPrescriptionForWeek(reReportedToday).singleLeg).toBe(false);
  });

  it("ramps from the report date, not the running plan week", () => {
    const start = new Date("2026-07-01T12:00:00Z");
    expect(achillesProgramWeek(start, new Date("2026-07-01T12:00:00Z"), 14)).toBe(1);
    expect(achillesProgramWeek(start, new Date("2026-07-14T12:00:00Z"), 14)).toBe(2);
    expect(achillesProgramWeek(start, new Date("2026-08-12T12:00:00Z"), 14)).toBe(7);
  });

  it("falls back to the running plan week when the clock was never started", () => {
    expect(achillesProgramWeek(null, new Date("2026-07-30T12:00:00Z"), 4)).toBe(4);
  });

  it("never returns a week before 1 for a session dated before the report", () => {
    const start = new Date("2026-07-30T12:00:00Z");
    expect(achillesProgramWeek(start, new Date("2026-07-01T12:00:00Z"), 9)).toBe(1);
  });
});

describe("a session that is already under way", () => {
  // Achilles/HSR work no longer lives on a plain "lower" session at all — it
  // has its own dedicated session type, whose content never varies by
  // complaint (see program.ts sessionTemplateFor). So the frozen-snapshot
  // behaviour that matters for a plain session is exercised through a
  // complaint that still gets injected there (knee) instead.
  it("keeps the complaints it was built with after the setting changes", () => {
    // The athlete logged sets against the knee work, then turned it off.
    const frozen: Complaint[] = ["knee"];
    const nowReported: Complaint[] = [];
    const plan = buildSessionPlan("lower", {
      complaints: effectiveComplaints(frozen, nowReported),
    }).map((e) => e.slug);
    expect(plan).toContain("step_down");
  });

  it("does not lose an exercise a set was logged against", () => {
    const loggedAgainst = ["step_down"];
    const plan = buildSessionPlan("lower", {
      complaints: effectiveComplaints(["knee"], []),
    }).map((e) => e.slug);
    for (const slug of loggedAgainst) expect(plan).toContain(slug);
  });

  it("follows the current settings when it was never started", () => {
    const plan = buildSessionPlan("lower", {
      complaints: effectiveComplaints(null, []),
    }).map((e) => e.slug);
    expect(plan).not.toContain("step_down");
  });

  it("treats an empty snapshot as its own answer, not as absent", () => {
    // A session started while the athlete reported nothing must not pick up
    // work from a complaint they added afterwards.
    expect(effectiveComplaints([], ["knee"])).toEqual([]);
  });
});

describe("history survives a complaint change", () => {
  const history: Record<string, ExerciseSessionHistory[]> = {
    straight_knee_calf_raise: [
      {
        sessionId: "s1",
        date: new Date("2026-07-20T10:00:00Z"),
        sets: [
          { setNumber: 1, weightKg: 22.5, reps: 10, rpe: 7 },
          { setNumber: 2, weightKg: 22.5, reps: 10, rpe: 7 },
        ],
      },
    ],
  };

  it("prefills the same load after the complaint is removed and re-reported", () => {
    // History is keyed by exercise slug, never by complaint, so the calf raise
    // an athlete comes back to still knows what they last lifted. The calf
    // raise now lives on the dedicated "achilles" session type.
    const before = buildSessionPlan("achilles", {
      complaints: ["achilles"],
      historyBySlug: history,
      programWeek: 6,
    }).find((e) => e.slug === "straight_knee_calf_raise");
    const after = buildSessionPlan("achilles", {
      complaints: ["achilles"],
      historyBySlug: history,
      programWeek: 1,
    }).find((e) => e.slug === "straight_knee_calf_raise");

    expect(before?.lastWeightKg).toBe(22.5);
    expect(after?.lastWeightKg).toBe(22.5);
    expect(after?.lastDate).toBe(before?.lastDate);
  });

  it("keeps the pain overlay on work that has scores logged against it", () => {
    // Removing a complaint hides pain tracking on future work; it does not
    // erase what was recorded, so a chart with scores keeps showing them.
    expect(isPainTrackedExercise("straight_knee_calf_raise", [], true)).toBe(true);
    expect(isPainTrackedExercise("straight_knee_calf_raise", [], false)).toBe(false);
    expect(isPainTrackedExercise("straight_knee_calf_raise", ["achilles"], false)).toBe(true);
  });

  it("never overlays pain on ordinary lifts", () => {
    expect(isPainTrackedExercise("goblet_squat", ["achilles"], true)).toBe(false);
  });
});
