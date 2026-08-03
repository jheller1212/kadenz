import { describe, expect, it } from "vitest";
import { buildSessionPlan } from "../session";
import { EXERCISE_BY_SLUG, sessionTemplateFor, TARGETED_WORK } from "../program";
import { fitSessionToDuration, type DurationFitExercise } from "../duration-fit";
import { rotationFor } from "../reconcile";
import { STRENGTH_SESSION_TYPES, type Complaint } from "../types";

// Slugs that belong to the Achilles/HSR rehab programme — a general runner
// with no reported Achilles complaint must never see any of them.
const ACHILLES_SLUGS = new Set([
  "explosive_box_step_up",
  "loaded_toe_walk",
  "straight_knee_calf_raise",
  "bent_knee_calf_raise",
]);

const NON_ACHILLES_TYPES = ["upper", "lower", "full_body"] as const;
const ALL_COMPLAINTS_EXCEPT_ACHILLES: Complaint[] = [
  "plantar_fascia",
  "shin",
  "knee",
  "itb",
  "hamstring",
  "hip_glute",
];

describe("no-complaint athlete never gets HSR/Achilles work", () => {
  it("plain session types (upper/lower/full_body) never contain achilles-role exercises", () => {
    for (const type of NON_ACHILLES_TYPES) {
      const plan = buildSessionPlan(type);
      for (const ex of plan) {
        expect(ACHILLES_SLUGS.has(ex.slug)).toBe(false);
        expect(EXERCISE_BY_SLUG[ex.slug]?.achillesRole).toBeFalsy();
      }
    }
  });

  it("STRENGTH_SESSION_TYPES omits nothing — achilles types still exist for those who need them", () => {
    // Sanity: the achilles types weren't deleted, just made conditional.
    expect(STRENGTH_SESSION_TYPES).toContain("achilles");
    expect(STRENGTH_SESSION_TYPES).toContain("lower_achilles");
    expect(STRENGTH_SESSION_TYPES).toContain("upper_achilles");
  });

  it("default (running_focus, no achilles complaint) rotation never selects an achilles session type", () => {
    for (let n = 1; n <= 4; n++) {
      const rotation = rotationFor("running_focus", n, []);
      for (const type of rotation) {
        expect(["achilles", "lower_achilles", "upper_achilles"]).not.toContain(type);
      }
    }
  });

  it("default (all_round, no achilles complaint) rotation never selects an achilles session type", () => {
    for (let n = 1; n <= 4; n++) {
      const rotation = rotationFor("all_round", n, []);
      for (const type of rotation) {
        expect(["achilles", "lower_achilles", "upper_achilles"]).not.toContain(type);
      }
    }
  });

  it("keeps ordinary calf work on lower/full_body — not the HSR rehab lifts", () => {
    const lower = buildSessionPlan("lower");
    const fullBody = buildSessionPlan("full_body");
    expect(lower.some((e) => e.slug === "standing_calf_raise")).toBe(true);
    expect(fullBody.some((e) => e.slug === "standing_calf_raise")).toBe(true);
  });
});

describe("achilles-reporting athlete gets exactly today's programme", () => {
  // An "achilles" complaint schedules the dedicated "achilles" session type
  // as its own, separate session (see reconcile.ts computeAchillesPlacements)
  // — it no longer reshapes the plain lower/upper/full_body rotation types.
  // rotationFor still accepts a `complaints` argument for backward
  // compatibility with existing callers, but it never changes which of the
  // plain types are scheduled; the achilles session is placed by its own
  // pass, outside this rotation.
  it("running_focus rotation is unaffected by an achilles complaint — never a dedicated achilles type", () => {
    for (let n = 1; n <= 4; n++) {
      const withAchilles = rotationFor("running_focus", n, ["achilles"]);
      const without = rotationFor("running_focus", n, []);
      expect(withAchilles).toEqual(without);
      for (const type of withAchilles) {
        expect(["achilles", "lower_achilles", "upper_achilles"]).not.toContain(type);
      }
    }
  });

  it("all_round rotation is unaffected by an achilles complaint — never a dedicated achilles type", () => {
    for (let n = 1; n <= 4; n++) {
      const withAchilles = rotationFor("all_round", n, ["achilles"]);
      const without = rotationFor("all_round", n, []);
      expect(withAchilles).toEqual(without);
      for (const type of withAchilles) {
        expect(["achilles", "lower_achilles", "upper_achilles"]).not.toContain(type);
      }
    }
  });

  it("an achilles complaint no longer reshapes the plain lower/upper/full_body sessions — that work is its own scheduled session now", () => {
    for (const type of NON_ACHILLES_TYPES) {
      const plan = buildSessionPlan(type, { complaints: ["achilles"] });
      for (const slug of ACHILLES_SLUGS) {
        expect(plan.some((e) => e.slug === slug)).toBe(false);
      }
    }
  });

  it("the dedicated 'achilles' session type still carries the full explosive-then-HSR block", () => {
    const plan = buildSessionPlan("achilles", { complaints: ["achilles"] });
    for (const slug of ACHILLES_SLUGS) {
      expect(plan.some((e) => e.slug === slug)).toBe(true);
    }
  });

  it("historic achilles/lower_achilles/upper_achilles session templates are still exactly what they were — unaffected by any complaint list", () => {
    for (const type of ["achilles", "lower_achilles", "upper_achilles"] as const) {
      const plain = buildSessionPlan(type);
      const withExtraComplaints = buildSessionPlan(type, {
        complaints: ["achilles", ...ALL_COMPLAINTS_EXCEPT_ACHILLES],
      });
      expect(withExtraComplaints.map((e) => e.slug)).toEqual(plain.map((e) => e.slug));
    }
  });

  it("still enforces explosive-before-slow-heavy ordering on the dedicated achilles session", () => {
    const plan = buildSessionPlan("achilles", {
      complaints: ["achilles", "knee", "hamstring"],
    });
    const explosiveIdx = plan.findIndex((p) => p.slug === "explosive_box_step_up");
    const hsrIdx = plan.findIndex((p) => p.slug === "straight_knee_calf_raise");
    expect(explosiveIdx).toBeGreaterThanOrEqual(0);
    expect(hsrIdx).toBeGreaterThan(explosiveIdx);
  });

  it("STRENGTH_SESSION_TYPES still contains the historic achilles types so old sessions keep loading", () => {
    expect(STRENGTH_SESSION_TYPES).toContain("achilles");
    expect(STRENGTH_SESSION_TYPES).toContain("lower_achilles");
    expect(STRENGTH_SESSION_TYPES).toContain("upper_achilles");
  });
});

describe("each other complaint adds its targeted work to the right session", () => {
  for (const complaint of ALL_COMPLAINTS_EXCEPT_ACHILLES) {
    it(`${complaint} adds its targeted exercise to lower and full_body only`, () => {
      const targeted = TARGETED_WORK[complaint]!;
      const lower = buildSessionPlan("lower", { complaints: [complaint] });
      const fullBody = buildSessionPlan("full_body", { complaints: [complaint] });
      const upper = buildSessionPlan("upper", { complaints: [complaint] });

      expect(lower.some((e) => e.slug === targeted.slug)).toBe(true);
      expect(fullBody.some((e) => e.slug === targeted.slug)).toBe(true);
      expect(upper.some((e) => e.slug === targeted.slug)).toBe(false);

      const addedSlot = lower.find((e) => e.slug === targeted.slug)!;
      expect(addedSlot.priority).toBe("targeted");
    });
  }

  it("does not add targeted work when the complaint isn't reported", () => {
    const lower = buildSessionPlan("lower", { complaints: [] });
    for (const complaint of ALL_COMPLAINTS_EXCEPT_ACHILLES) {
      const targeted = TARGETED_WORK[complaint]!;
      expect(lower.some((e) => e.slug === targeted.slug)).toBe(false);
    }
  });

  it("multiple complaints stack additively without duplicate slots", () => {
    const template = sessionTemplateFor("lower", ["knee", "hamstring", "hip_glute"]);
    const slugs = template.slots.map((s) => s.exerciseSlug);
    expect(slugs).toContain(TARGETED_WORK.knee!.slug);
    expect(slugs).toContain(TARGETED_WORK.hamstring!.slug);
    expect(slugs).toContain(TARGETED_WORK.hip_glute!.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicates
  });
});

describe("duration fitting never trims the targeted work", () => {
  it("keeps a targeted exercise present at every offered duration, even the shortest", () => {
    for (const complaint of ALL_COMPLAINTS_EXCEPT_ACHILLES) {
      const targeted = TARGETED_WORK[complaint]!;
      for (const minutes of [30, 45, 60]) {
        const plan = buildSessionPlan("lower", {
          complaints: [complaint],
          targetDurationMinutes: minutes,
        });
        expect(plan.some((e) => e.slug === targeted.slug)).toBe(true);
      }
    }
  });

  it("the pure fitter never drops a 'targeted' exercise whole, even at an impossibly small budget", () => {
    const plan: DurationFitExercise[] = [
      { slug: "primary_lift", sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, priority: "primary", setsLocked: false },
      { slug: "targeted_lift", sets: 3, repLow: 10, repHigh: 15, restSeconds: 60, priority: "targeted", setsLocked: false },
    ];
    const { exercises } = fitSessionToDuration(plan, 1);
    expect(exercises.some((e) => e.slug === "targeted_lift")).toBe(true);
  });

  it("trims accessory work before ever reducing targeted work's sets", () => {
    const plan: DurationFitExercise[] = [
      { slug: "targeted_lift", sets: 3, repLow: 10, repHigh: 15, restSeconds: 60, priority: "targeted", setsLocked: false },
      { slug: "accessory_lift", sets: 3, repLow: 10, repHigh: 15, restSeconds: 60, priority: "accessory", setsLocked: false },
    ];
    // Budget tight enough to force one exercise out, but not so tight that
    // the targeted lift alone would need trimming below its base sets.
    const { exercises } = fitSessionToDuration(plan, 6);
    expect(exercises.find((e) => e.slug === "accessory_lift")).toBeUndefined();
    expect(exercises.find((e) => e.slug === "targeted_lift")!.sets).toBeGreaterThanOrEqual(3);
  });
});

describe("targeted work still appears for an athlete with no box or chair", () => {
  // step_down (knee) and nordic_curl_negative (hamstring) hard-require a box
  // or chair. Targeted work is protected like Achilles work — it must never
  // just disappear because the equipment isn't there.
  it("a knee complaint with zero equipment still gets a targeted exercise, not nothing", () => {
    const lower = buildSessionPlan("lower", { complaints: ["knee"], equipment: [] });
    const targeted = lower.filter((e) => e.priority === "targeted");
    expect(targeted.length).toBe(1);
    expect(targeted[0].slug).not.toBe(""); // resolved to a real exercise
  });

  it("a hamstring complaint with zero equipment still gets a targeted exercise, not nothing", () => {
    const fullBody = buildSessionPlan("full_body", { complaints: ["hamstring"], equipment: [] });
    const targeted = fullBody.filter((e) => e.priority === "targeted");
    expect(targeted.length).toBe(1);
    expect(targeted[0].slug).not.toBe("");
  });

  it("the zero-equipment fallback for knee/hamstring is a real, zero-equipment exercise", () => {
    const lower = buildSessionPlan("lower", {
      complaints: ["knee", "hamstring"],
      equipment: [],
    });
    const targeted = lower.filter((e) => e.priority === "targeted");
    expect(targeted.length).toBe(2);
    for (const t of targeted) {
      expect(EXERCISE_BY_SLUG[t.slug]?.equipment ?? []).toEqual([]);
    }
  });

  it("knee/hamstring targeted work still resolves to the box/chair exercise when available", () => {
    const withBox = buildSessionPlan("lower", { complaints: ["knee"], equipment: ["box"] });
    expect(withBox.some((e) => e.slug === "step_down")).toBe(true);
    const withChair = buildSessionPlan("full_body", { complaints: ["hamstring"], equipment: ["chair"] });
    expect(withChair.some((e) => e.slug === "nordic_curl_negative")).toBe(true);
  });

  it("targeted work's bodyweight fallback never collides with the session's own bodyweight floor", () => {
    // Zero equipment: romanian_deadlift already falls back to the shared
    // hinge/hip-thrust bodyweight floor — the targeted fallback must be a
    // genuinely different exercise, not deduped away.
    const lower = buildSessionPlan("lower", { complaints: ["hamstring"], equipment: [] });
    const slugs = lower.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(lower.some((e) => e.priority === "targeted")).toBe(true);
  });
});

describe("existing rows with no complaints behave like 'none'", () => {
  it("rotationFor treats an empty complaints array as the general default", () => {
    // 2/week is lower/upper regardless of goal (see reconcile.ts
    // rotationForEmphasis) — the complaints argument shouldn't change that.
    expect(rotationFor("running_focus", 2, [])).toEqual(["lower", "upper"]);
  });

  it("buildSessionPlan with complaints omitted behaves identically to an empty array", () => {
    const omitted = buildSessionPlan("lower");
    const empty = buildSessionPlan("lower", { complaints: [] });
    expect(omitted.map((e) => e.slug)).toEqual(empty.map((e) => e.slug));
  });
});
