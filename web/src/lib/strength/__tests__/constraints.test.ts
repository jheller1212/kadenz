import { describe, expect, it } from "vitest";
import { validateStrengthPlacement, worstSeverity } from "../constraints";
import type { StrengthRef, RunRef } from "../constraints";

const D = (s: string) => new Date(`${s}T09:00:00`);

describe("validateStrengthPlacement", () => {
  it("blocks Lower+Achilles the day before a hard run", () => {
    const session: StrengthRef = { date: D("2026-06-10"), type: "lower_achilles" };
    const runs: RunRef[] = [{ date: D("2026-06-11"), type: "interval" }];
    const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
    expect(v.some((x) => x.code === "achilles_before_hard_run")).toBe(true);
    expect(worstSeverity(v)).toBe("error");
  });

  it("allows calf HSR the day before a long easy run", () => {
    const session: StrengthRef = { date: D("2026-06-10"), type: "lower_achilles" };
    const runs: RunRef[] = [{ date: D("2026-06-11"), type: "long" }];
    const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
    expect(v.some((x) => x.code === "achilles_before_hard_run")).toBe(false);
  });

  it("blocks explosive Achilles work on the same day as an interval run", () => {
    const session: StrengthRef = { date: D("2026-06-10"), type: "lower_achilles" };
    const runs: RunRef[] = [{ date: D("2026-06-10"), type: "interval" }];
    const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
    expect(v.some((x) => x.code === "explosive_with_interval")).toBe(true);
  });

  it("warns (but allows) a lower day sharing a long run day", () => {
    const session: StrengthRef = { date: D("2026-06-10"), type: "lower" };
    const runs: RunRef[] = [{ date: D("2026-06-10"), type: "long" }];
    const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
    expect(v.some((x) => x.code === "lower_with_long_run" && x.severity === "warn")).toBe(true);
    expect(worstSeverity(v)).toBe("warn");
  });

  it("enforces the 3-per-rolling-7-days Achilles cap", () => {
    const session: StrengthRef = { date: D("2026-06-08"), type: "lower_achilles" };
    const existing: StrengthRef[] = [
      { date: D("2026-06-04"), type: "lower_achilles" },
      { date: D("2026-06-06"), type: "lower_achilles" },
      { date: D("2026-06-10"), type: "lower_achilles" },
    ];
    const v = validateStrengthPlacement({ session, runWorkouts: [], strengthSessions: existing });
    expect(v.some((x) => x.code === "achilles_frequency_cap")).toBe(true);
  });

  it("allows a 4th Achilles block once it's outside the 7-day window", () => {
    const session: StrengthRef = { date: D("2026-06-20"), type: "lower_achilles" };
    const existing: StrengthRef[] = [
      { date: D("2026-06-04"), type: "lower_achilles" },
      { date: D("2026-06-06"), type: "lower_achilles" },
      { date: D("2026-06-08"), type: "lower_achilles" },
    ];
    const v = validateStrengthPlacement({ session, runWorkouts: [], strengthSessions: existing });
    expect(v.some((x) => x.code === "achilles_frequency_cap")).toBe(false);
  });

  it("excludes the session being moved from the cap count (by id)", () => {
    const session: StrengthRef = { id: "s1", date: D("2026-06-09"), type: "lower_achilles" };
    const existing: StrengthRef[] = [
      { id: "s1", date: D("2026-06-08"), type: "lower_achilles" }, // same session, old date
      { id: "s2", date: D("2026-06-06"), type: "lower_achilles" },
      { id: "s3", date: D("2026-06-04"), type: "lower_achilles" },
    ];
    const v = validateStrengthPlacement({ session, runWorkouts: [], strengthSessions: existing });
    expect(v.some((x) => x.code === "achilles_frequency_cap")).toBe(false);
  });

  // Achilles/HSR work is scheduled as its own dedicated "achilles" session
  // now (see reconcile.ts computeAchillesPlacements), not injected into a
  // plain lower/upper/full_body session for an athlete who reports the
  // complaint (see program.ts sessionTemplateFor) — so these rules must key
  // entirely off session `type`, never off a complaint flag.
  describe("plain lower/upper/full_body sessions never carry the Achilles block", () => {
    it("a plain 'lower' session never trips the before-hard-run rule", () => {
      const session: StrengthRef = { date: D("2026-06-10"), type: "lower" };
      const runs: RunRef[] = [{ date: D("2026-06-11"), type: "interval" }];
      const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
      expect(v.some((x) => x.code === "achilles_before_hard_run")).toBe(false);
    });

    it("a plain 'full_body' session never counts toward the weekly Achilles cap", () => {
      const session: StrengthRef = { date: D("2026-06-08"), type: "full_body" };
      const existing: StrengthRef[] = [
        { date: D("2026-06-04"), type: "upper" },
        { date: D("2026-06-06"), type: "lower" },
        { date: D("2026-06-10"), type: "full_body" },
      ];
      const v = validateStrengthPlacement({ session, runWorkouts: [], strengthSessions: existing });
      expect(v.some((x) => x.code === "achilles_frequency_cap")).toBe(false);
    });

    it("a plain 'upper' session never trips the explosive-work/interval collision", () => {
      const session: StrengthRef = { date: D("2026-06-10"), type: "upper" };
      const runs: RunRef[] = [{ date: D("2026-06-10"), type: "interval" }];
      const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
      expect(v.some((x) => x.code === "explosive_with_interval")).toBe(false);
    });
  });

  // The dedicated "achilles" type carries the block on its own — no complaint
  // flag needed, matching how it's actually scheduled.
  describe("the dedicated 'achilles' session type", () => {
    it("is blocked the day before a hard run", () => {
      const session: StrengthRef = { date: D("2026-06-10"), type: "achilles" };
      const runs: RunRef[] = [{ date: D("2026-06-11"), type: "interval" }];
      const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
      expect(v.some((x) => x.code === "achilles_before_hard_run")).toBe(true);
    });

    it("counts toward the weekly Achilles cap alongside other achilles sessions", () => {
      const session: StrengthRef = { date: D("2026-06-08"), type: "achilles" };
      const existing: StrengthRef[] = [
        { date: D("2026-06-04"), type: "achilles" },
        { date: D("2026-06-06"), type: "achilles" },
        { date: D("2026-06-10"), type: "achilles" },
      ];
      const v = validateStrengthPlacement({ session, runWorkouts: [], strengthSessions: existing });
      expect(v.some((x) => x.code === "achilles_frequency_cap")).toBe(true);
    });

    it("blocks explosive work on the same day as an interval run", () => {
      const session: StrengthRef = { date: D("2026-06-10"), type: "achilles" };
      const runs: RunRef[] = [{ date: D("2026-06-10"), type: "interval" }];
      const v = validateStrengthPlacement({ session, runWorkouts: runs, strengthSessions: [] });
      expect(v.some((x) => x.code === "explosive_with_interval")).toBe(true);
    });
  });
});
