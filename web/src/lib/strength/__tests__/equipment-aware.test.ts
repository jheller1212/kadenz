import { describe, expect, it } from "vitest";
import { buildSessionPlan } from "../session";
import { EXERCISE_BY_SLUG, EXERCISES, resolveSlotVariant, SESSION_TEMPLATES } from "../program";
import { STRENGTH_SESSION_TYPES, type Equipment, type TemplateSlot } from "../types";

// ── Equipment-aware generation ──────────────────────────────────────────────
//
// The equipment picker only matters if it actually changes what plan
// generation hands back. These tests cover: a well-equipped athlete gets the
// better variant, a bodyweight-only athlete still gets a complete session,
// Achilles work is never touched by variant selection, and the catalogue
// entries generation depends on are all well-formed.

const ACHILLES_SLUGS = new Set([
  "explosive_box_step_up",
  "loaded_toe_walk",
  "straight_knee_calf_raise",
  "bent_knee_calf_raise",
]);

describe("resolveSlotVariant", () => {
  it("with no equipment info, always returns the slot's own base exercise", () => {
    const slot: TemplateSlot = {
      exerciseSlug: "db_squat",
      sets: 3,
      repLow: 8,
      repHigh: 12,
      restSeconds: 90,
      variants: [{ exerciseSlug: "barbell_back_squat", equipment: ["barbell"] }],
    };
    expect(resolveSlotVariant(slot, null).slug).toBe("db_squat");
  });

  it("picks the best variant the athlete's equipment covers", () => {
    const slot = SESSION_TEMPLATES.lower.slots.find((s) => s.exerciseSlug === "db_squat")!;
    expect(resolveSlotVariant(slot, ["barbell"]).slug).toBe("barbell_back_squat");
    expect(resolveSlotVariant(slot, ["dumbbell"]).slug).toBe("db_squat");
    expect(resolveSlotVariant(slot, ["kettlebell"]).slug).toBe("kettlebell_squat");
    expect(resolveSlotVariant(slot, []).slug).toBe("air_squat");
  });

  it("never resolves to nothing, even with zero equipment", () => {
    for (const template of Object.values(SESSION_TEMPLATES)) {
      for (const slot of template.slots) {
        const resolved = resolveSlotVariant(slot, []);
        expect(EXERCISE_BY_SLUG[resolved.slug]).toBeDefined();
      }
    }
  });
});

describe("a barbell-and-bench athlete gets barbell variants", () => {
  const equipment: Equipment[] = ["barbell", "bench"];

  it("lower day squat and hinge slots resolve to barbell lifts", () => {
    const plan = buildSessionPlan("lower", { equipment });
    expect(plan.some((e) => e.slug === "barbell_back_squat")).toBe(true);
    expect(plan.some((e) => e.slug === "barbell_straight_leg_deadlift")).toBe(true);
  });

  it("upper day press and row slots resolve to barbell/bench lifts", () => {
    const plan = buildSessionPlan("upper", { equipment });
    expect(plan.some((e) => e.slug === "barbell_bench_press")).toBe(true);
    expect(plan.some((e) => e.slug === "barbell_row")).toBe(true);
  });

  it("full_body's hip-thrust accessory upgrades to the barbell + bench variant", () => {
    const plan = buildSessionPlan("full_body", { equipment });
    expect(plan.some((e) => e.slug === "barbell_hip_thrust_with_bench")).toBe(true);
  });
});

describe("a bodyweight-only athlete gets a complete session, no missing slots", () => {
  for (const type of STRENGTH_SESSION_TYPES) {
    it(`${type}: every remaining slot resolves to a real, zero-equipment-safe exercise`, () => {
      const plan = buildSessionPlan(type, { equipment: [] });
      expect(plan.length).toBeGreaterThan(0);
      for (const e of plan) {
        const def = EXERCISE_BY_SLUG[e.slug];
        expect(def).toBeDefined();
        // Achilles-role work is never equipment-gated (see below) — every
        // other resolved exercise must be genuinely doable with no kit.
        if (!def.achillesRole) {
          expect(def.equipment ?? []).toEqual([]);
        }
      }
    });
  }

  it("still gets every primary lift, just as bodyweight variants", () => {
    const plan = buildSessionPlan("lower", { equipment: [] });
    const primaries = plan.filter((e) => e.priority === "primary");
    expect(primaries.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Achilles work survives equipment-aware generation", () => {
  it("achilles-role exercises appear unchanged for a bodyweight-only athlete", () => {
    const plain = buildSessionPlan("lower_achilles");
    const bodyweight = buildSessionPlan("lower_achilles", { equipment: [] });
    const achillesSlugs = (plan: typeof plain) =>
      plan.filter((e) => ACHILLES_SLUGS.has(e.slug)).map((e) => e.slug);
    expect(achillesSlugs(bodyweight)).toEqual(achillesSlugs(plain));
  });

  it("achilles-role exercises appear unchanged for a fully-equipped athlete", () => {
    const plain = buildSessionPlan("upper_achilles");
    const fullyEquipped = buildSessionPlan("upper_achilles", {
      equipment: ["dumbbell", "barbell", "bench", "chair", "box", "kettlebell", "pullup_bar", "band"],
    });
    const achillesSlugs = (plan: typeof plain) =>
      plan.filter((e) => ACHILLES_SLUGS.has(e.slug)).map((e) => e.slug);
    expect(achillesSlugs(fullyEquipped)).toEqual(achillesSlugs(plain));
  });

  it("explosive-before-slow-heavy ordering still holds with equipment set", () => {
    const plan = buildSessionPlan("lower_achilles", { equipment: [] });
    const explosiveIdx = plan.findIndex((p) => p.slug === "explosive_box_step_up");
    const hsrIdx = plan.findIndex((p) => p.slug === "straight_knee_calf_raise");
    expect(explosiveIdx).toBeGreaterThanOrEqual(0);
    expect(hsrIdx).toBeGreaterThan(explosiveIdx);
  });
});

describe("equipment-unaware callers are unaffected (backward compatibility)", () => {
  it("omitting equipment behaves identically to before variants existed", () => {
    for (const type of STRENGTH_SESSION_TYPES) {
      const plan = buildSessionPlan(type);
      const template = SESSION_TEMPLATES[type];
      expect(plan.map((e) => e.slug)).toEqual(template.slots.map((s) => s.exerciseSlug));
    }
  });
});

describe("catalogue entries generation depends on are well-formed", () => {
  it("every exercise has a non-empty slug and name", () => {
    for (const e of EXERCISES) {
      expect(e.slug.length).toBeGreaterThan(0);
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("every slug is unique", () => {
    const slugs = EXERCISES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every exercise declares a category and rep range generation can use", () => {
    for (const e of EXERCISES) {
      expect(["upper", "lower", "full_body", "achilles"]).toContain(e.category);
      expect(e.repLow).toBeGreaterThan(0);
      expect(e.repHigh).toBeGreaterThanOrEqual(e.repLow ?? 0);
      expect(e.defaultSets).toBeGreaterThan(0);
    }
  });

  it("barbell entries prescribe a whole-bar starting load, not a per-dumbbell one", () => {
    for (const e of EXERCISES) {
      if (!e.equipment?.includes("barbell")) continue;
      // An empty Olympic bar (20 kg) is the realistic floor for a barbell
      // lift — anything much lower would mean treating the field like a
      // per-hand dumbbell load by mistake.
      expect(e.startWeightKg).toBeGreaterThanOrEqual(15);
    }
  });

  it("every equipment type in the picker now unlocks at least one exercise", () => {
    const ALL_EQUIPMENT: Equipment[] = [
      "dumbbell", "barbell", "bench", "chair", "box", "kettlebell", "pullup_bar", "band",
    ];
    for (const eq of ALL_EQUIPMENT) {
      const count = EXERCISES.filter((e) => (e.equipment ?? []).includes(eq)).length;
      expect(count).toBeGreaterThan(0);
    }
  });
});
