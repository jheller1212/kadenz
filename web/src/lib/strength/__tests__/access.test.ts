import { describe, expect, it } from "vitest";
import { buildSessionPlan } from "../session";
import { EXERCISES } from "../program";
import { STRENGTH_SESSION_TYPES } from "../types";
import {
  ACCESS_LEVELS,
  ACCESS_PRESETS,
  accessForEquipment,
  exerciseCountForEquipment,
} from "../equipment";

// ── Gym access presets (Kraft setup) ──────────────────────────────────────────
//
// "Where do you train?" is a shortcut over the equipment list, not a second
// setting — these tests cover the shortcut itself (each preset produces the
// equipment it claims, round-trips back to the same preset, and "full gym"
// really does unlock more than "box" now that machine exercises exist) plus
// the two session-generation guarantees the access step exists to serve: a
// bodyweight-only athlete never gets a repeated exercise, and a full-gym
// session is genuinely different from a box session.

describe("each access preset produces the equipment set it claims", () => {
  it("home is bodyweight only", () => {
    expect(ACCESS_PRESETS.home.equipment).toEqual([]);
  });

  it("box has free weights, boxes, bands, benches, pull-up bars — no machine", () => {
    const eq = ACCESS_PRESETS.box.equipment;
    expect(eq).toContain("dumbbell");
    expect(eq).toContain("barbell");
    expect(eq).toContain("bench");
    expect(eq).toContain("kettlebell");
    expect(eq).toContain("pullup_bar");
    expect(eq).toContain("band");
    expect(eq).toContain("box");
    expect(eq).not.toContain("machine");
  });

  it("full gym is everything box has, plus machine", () => {
    const box = new Set(ACCESS_PRESETS.box.equipment);
    const fullGym = new Set(ACCESS_PRESETS.full_gym.equipment);
    for (const item of box) expect(fullGym.has(item)).toBe(true);
    expect(fullGym.has("machine")).toBe(true);
    expect(fullGym.size).toBe(box.size + 1);
  });

  it("round-trips: accessForEquipment recognises every preset's own set", () => {
    for (const level of ACCESS_LEVELS) {
      expect(accessForEquipment(ACCESS_PRESETS[level].equipment)).toBe(level);
    }
  });

  it("a hand-edited equipment set matches no preset", () => {
    expect(accessForEquipment(["dumbbell", "machine"])).toBeNull();
  });
});

describe("exerciseCountForEquipment reflects the real catalogue", () => {
  it("home unlocks only the zero-equipment exercises", () => {
    const bodyweightCount = EXERCISES.filter((e) => (e.equipment ?? []).length === 0).length;
    expect(exerciseCountForEquipment(ACCESS_PRESETS.home.equipment)).toBe(bodyweightCount);
  });

  it("full gym unlocks strictly more exercises than box (machine exercises exist)", () => {
    const boxCount = exerciseCountForEquipment(ACCESS_PRESETS.box.equipment);
    const fullGymCount = exerciseCountForEquipment(ACCESS_PRESETS.full_gym.equipment);
    expect(fullGymCount).toBeGreaterThan(boxCount);
  });
});

describe("a bodyweight-only athlete gets a session with no repeated exercise", () => {
  for (const type of STRENGTH_SESSION_TYPES) {
    it(`${type}: every resolved exercise slug appears at most once`, () => {
      const plan = buildSessionPlan(type, { equipment: ACCESS_PRESETS.home.equipment });
      const slugs = plan.map((e) => e.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });
  }
});

describe("the three access presets produce visibly different sessions", () => {
  it("full gym's accessory work differs from box's on lower/full_body/lower_achilles/upper", () => {
    for (const type of ["lower", "full_body", "lower_achilles", "upper"] as const) {
      const box = buildSessionPlan(type, { equipment: ACCESS_PRESETS.box.equipment });
      const fullGym = buildSessionPlan(type, { equipment: ACCESS_PRESETS.full_gym.equipment });
      expect(fullGym.map((e) => e.slug)).not.toEqual(box.map((e) => e.slug));
    }
  });

  it("full gym actually prescribes machine exercises where box doesn't", () => {
    for (const type of ["lower", "full_body", "lower_achilles", "upper"] as const) {
      const box = buildSessionPlan(type, { equipment: ACCESS_PRESETS.box.equipment });
      const fullGym = buildSessionPlan(type, { equipment: ACCESS_PRESETS.full_gym.equipment });
      const boxUsesMachine = box.some((e) => (EXERCISES.find((x) => x.slug === e.slug)?.equipment ?? []).includes("machine"));
      const fullGymUsesMachine = fullGym.some((e) => (EXERCISES.find((x) => x.slug === e.slug)?.equipment ?? []).includes("machine"));
      expect(boxUsesMachine).toBe(false);
      expect(fullGymUsesMachine).toBe(true);
    }
  });

  it("home differs from both box and full gym", () => {
    // "achilles" is a pure tendon-rehab session with no equipment-gated
    // slots at all — every other type has at least one squat/hinge/press/row
    // pattern or accessory that actually depends on equipment.
    for (const type of STRENGTH_SESSION_TYPES.filter((t) => t !== "achilles")) {
      const home = buildSessionPlan(type, { equipment: ACCESS_PRESETS.home.equipment });
      const box = buildSessionPlan(type, { equipment: ACCESS_PRESETS.box.equipment });
      expect(home.map((e) => e.slug)).not.toEqual(box.map((e) => e.slug));
    }
  });

  it("no primary compound lift is swapped for a machine — machines only touch accessory slots", () => {
    for (const type of ["lower", "full_body", "lower_achilles", "upper", "upper_achilles"] as const) {
      const fullGym = buildSessionPlan(type, { equipment: ACCESS_PRESETS.full_gym.equipment });
      const primaries = fullGym.filter((e) => e.priority === "primary");
      for (const p of primaries) {
        expect((EXERCISES.find((x) => x.slug === p.slug)?.equipment ?? []).includes("machine")).toBe(false);
      }
    }
  });
});

describe("Achilles work is never touched by an access preset", () => {
  const ACHILLES_SLUGS = new Set([
    "explosive_box_step_up",
    "loaded_toe_walk",
    "straight_knee_calf_raise",
    "bent_knee_calf_raise",
  ]);

  it("lower_achilles' Achilles block is identical across home/box/full gym", () => {
    const achillesSlugs = (equipment: string[] | null) =>
      buildSessionPlan("lower_achilles", { equipment: equipment as never })
        .filter((e) => ACHILLES_SLUGS.has(e.slug))
        .map((e) => e.slug);
    const home = achillesSlugs(ACCESS_PRESETS.home.equipment);
    const box = achillesSlugs(ACCESS_PRESETS.box.equipment);
    const fullGym = achillesSlugs(ACCESS_PRESETS.full_gym.equipment);
    expect(home).toEqual(box);
    expect(box).toEqual(fullGym);
  });
});
