import { describe, it, expect } from "vitest";
import { ROUTINES, routineById, routineSeconds } from "../warmup";

describe("warmup routines", () => {
  it("has a dynamic warm-up and a post-run mobility routine", () => {
    expect(routineById("dynamic-warmup")).toBeDefined();
    expect(routineById("post-run-mobility")).toBeDefined();
    expect(routineById("nope")).toBeUndefined();
  });

  it("every drill has a positive duration and a cue", () => {
    for (const r of ROUTINES) {
      expect(r.drills.length).toBeGreaterThan(0);
      for (const d of r.drills) {
        expect(d.seconds).toBeGreaterThan(0);
        expect(d.cue.length).toBeGreaterThan(0);
      }
    }
  });

  it("routineSeconds sums the drills", () => {
    const r = routineById("dynamic-warmup")!;
    expect(routineSeconds(r)).toBe(r.drills.reduce((s, d) => s + d.seconds, 0));
    expect(routineSeconds(r)).toBeGreaterThan(120);
  });
});
