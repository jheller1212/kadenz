import { describe, expect, it } from "vitest";
import { fitSessionToDuration, type DurationFitExercise } from "../duration-fit";
import { buildSessionPlan, estimateSessionMinutes } from "../session";
import { STRENGTH_SESSION_TYPES } from "../types";

// ── Unit tests for the pure fitter ──────────────────────────────────────────

function ex(overrides: Partial<DurationFitExercise>): DurationFitExercise {
  return {
    slug: "x",
    sets: 3,
    repLow: 8,
    repHigh: 12,
    restSeconds: 90,
    priority: "primary",
    setsLocked: false,
    ...overrides,
  };
}

describe("fitSessionToDuration", () => {
  it("drops accessory exercises whole before touching sets", () => {
    const plan = [
      ex({ slug: "squat", priority: "primary", sets: 3 }),
      ex({ slug: "curl", priority: "accessory", sets: 3 }),
    ];
    // squat alone ~ (15+20*2)*3 + 90*2 = 165+180=345s=6min; both ~12min.
    const { exercises } = fitSessionToDuration(plan, 8);
    expect(exercises.find((e) => e.slug === "curl")).toBeUndefined();
    // The primary lift survives and is never *reduced* below its base sets
    // (it may grow to use the freed-up budget — that's intentional).
    expect(exercises.find((e) => e.slug === "squat")).toBeDefined();
    expect(exercises.find((e) => e.slug === "squat")!.sets).toBeGreaterThanOrEqual(3);
  });

  it("does not reduce a primary lift's sets below base when only accessory removal is needed", () => {
    const plan = [
      ex({ slug: "squat", priority: "primary", sets: 3 }),
      ex({ slug: "curl", priority: "accessory", sets: 3 }),
    ];
    // Budget just above squat-alone (~6 min): dropping curl is enough, no
    // set reduction on squat should occur.
    const { exercises } = fitSessionToDuration(plan, 6);
    expect(exercises.find((e) => e.slug === "curl")).toBeUndefined();
    expect(exercises.find((e) => e.slug === "squat")!.sets).toBe(3);
  });

  it("never removes achilles-role work, even when it would help fit the budget", () => {
    const plan = [
      ex({ slug: "hsr", priority: "achilles", setsLocked: true, sets: 3, restSeconds: 120 }),
      ex({ slug: "explosive", priority: "achilles", sets: 3, perSide: true, restSeconds: 90 }),
    ];
    const { exercises } = fitSessionToDuration(plan, 1); // impossibly small budget
    expect(exercises.some((e) => e.slug === "hsr")).toBe(true);
    expect(exercises.some((e) => e.slug === "explosive")).toBe(true);
    // HSR sets are untouched even under extreme pressure.
    expect(exercises.find((e) => e.slug === "hsr")!.sets).toBe(3);
  });

  it("never reduces setsLocked (HSR) exercises' sets", () => {
    const plan = [
      ex({ slug: "hsr", priority: "achilles", setsLocked: true, sets: 3, restSeconds: 120 }),
      ex({ slug: "squat", priority: "primary", sets: 5 }),
    ];
    const { exercises } = fitSessionToDuration(plan, 5);
    expect(exercises.find((e) => e.slug === "hsr")!.sets).toBe(3);
  });

  it("grows primary sets when well under the budget", () => {
    const plan = [ex({ slug: "squat", priority: "primary", sets: 3 })];
    const { exercises, estimatedMinutes } = fitSessionToDuration(plan, 30);
    // A single exercise is capped (MAX_SETS_DEFAULT) well before it could
    // ever fill a 30-min budget alone — it should grow to the cap and stop,
    // never exceeding the target.
    expect(exercises[0].sets).toBeGreaterThan(3);
    expect(estimatedMinutes).toBeLessThanOrEqual(30);
  });

  it("fills up to the tolerance floor when enough exercises are available to grow", () => {
    const plan = [
      ex({ slug: "a", priority: "primary", sets: 3 }),
      ex({ slug: "b", priority: "primary", sets: 3 }),
      ex({ slug: "c", priority: "primary", sets: 3 }),
    ];
    const { estimatedMinutes } = fitSessionToDuration(plan, 30);
    expect(estimatedMinutes).toBeLessThanOrEqual(30);
    expect(estimatedMinutes).toBeGreaterThanOrEqual(24); // 80% of 30
  });

  it("never exceeds the target budget when growing", () => {
    const plan = [ex({ slug: "squat", priority: "primary", sets: 3 })];
    const { estimatedMinutes } = fitSessionToDuration(plan, 30);
    expect(estimatedMinutes).toBeLessThanOrEqual(30);
  });

  it("is a no-op when the plan already fits within tolerance", () => {
    const plan = [ex({ slug: "squat", priority: "primary", sets: 3 })];
    const before = estimateSessionMinutes(plan as never);
    const { estimatedMinutes } = fitSessionToDuration(plan, before);
    expect(estimatedMinutes).toBe(before);
  });
});

// ── Integration: every session type × every offered duration ───────────────

const DURATIONS = [30, 45, 60] as const;

// Slugs whose achillesRole marks them as protected rehab/tendon work — these
// must survive trimming at every duration for every achilles-containing type.
const ACHILLES_SLUGS = new Set([
  "explosive_box_step_up",
  "straight_knee_calf_raise",
  "bent_knee_calf_raise",
  "loaded_toe_walk",
]);

describe("buildSessionPlan duration fitting (per type × per duration)", () => {
  for (const type of STRENGTH_SESSION_TYPES) {
    describe(type, () => {
      const results = DURATIONS.map((minutes) => {
        const plan = buildSessionPlan(type, { targetDurationMinutes: minutes });
        return { minutes, plan, estimate: estimateSessionMinutes(plan) };
      });

      for (const { minutes, plan, estimate } of results) {
        it(`fits within budget at ${minutes} min (estimate <= target, not absurdly under)`, () => {
          expect(estimate).toBeLessThanOrEqual(minutes);
          // ~20% tolerance: the choice should be felt, not just "not too long".
          expect(estimate).toBeGreaterThanOrEqual(Math.floor(minutes * 0.8));
        });

        it(`keeps every achilles/rehab exercise present at ${minutes} min`, () => {
          const achillesSlugsInTemplate = plan
            .filter((p) => ACHILLES_SLUGS.has(p.slug))
            .map((p) => p.slug);
          // Sanity: if the template has achilles work, none of it got dropped.
          const templateSlugs = buildSessionPlan(type)
            .filter((p) => ACHILLES_SLUGS.has(p.slug))
            .map((p) => p.slug);
          expect(new Set(achillesSlugsInTemplate)).toEqual(new Set(templateSlugs));
        });

        it(`never reduces HSR calf-raise sets from their week-based prescription at ${minutes} min`, () => {
          const full = buildSessionPlan(type);
          for (const slug of ["straight_knee_calf_raise", "bent_knee_calf_raise"]) {
            const fittedEx = plan.find((p) => p.slug === slug);
            const fullEx = full.find((p) => p.slug === slug);
            if (fittedEx && fullEx) expect(fittedEx.sets).toBe(fullEx.sets);
          }
        });
      }

      it("total prescribed work is monotonically increasing across 30 < 45 < 60", () => {
        const [d30, d45, d60] = results;
        expect(d45.estimate).toBeGreaterThan(d30.estimate);
        expect(d60.estimate).toBeGreaterThan(d45.estimate);
      });

      it("drops accessory exercises before any primary/achilles exercise at the shortest duration", () => {
        const full = buildSessionPlan(type);
        const short = results[0].plan;
        const droppedSlugs = full
          .filter((p) => !short.some((s) => s.slug === p.slug))
          .map((p) => p.slug);
        for (const slug of droppedSlugs) {
          const original = full.find((p) => p.slug === slug)!;
          expect(original.priority).toBe("accessory");
        }
      });
    });
  }
});
