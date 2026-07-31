import { describe, expect, it } from "vitest";
import { isWeekComplete, weekMilestoneFor } from "../celebrations";

const completed = (type = "easy") => ({ type, status: "completed" });
const missed = (type = "easy") => ({ type, status: "missed" });
const planned = (type = "easy") => ({ type, status: "planned" });
const rest = () => ({ type: "rest", status: "planned" });

describe("isWeekComplete", () => {
  it("fires on a genuinely completed week", () => {
    expect(isWeekComplete([completed(), completed("long"), rest()], null)).toBe(true);
  });

  it("does not fire on a mostly-missed week", () => {
    expect(isWeekComplete([completed(), missed("long"), missed("tempo")], null)).toBe(false);
  });

  it("does not fire when even one workout is still planned", () => {
    expect(isWeekComplete([completed(), planned("long")], null)).toBe(false);
  });

  it("does not fire on a week the athlete dropped entirely", () => {
    expect(isWeekComplete([completed(), completed("long")], new Date())).toBe(false);
  });

  it("does not fire on an empty week (nothing scheduled)", () => {
    expect(isWeekComplete([rest(), rest()], null)).toBe(false);
    expect(isWeekComplete([], null)).toBe(false);
  });
});

describe("weekMilestoneFor", () => {
  it("reports the phase the engine actually used", () => {
    expect(weekMilestoneFor("peak", null, [completed(), completed("long")])).toBe("peak-week");
    expect(weekMilestoneFor("build", null, [completed(), completed("long")])).toBe("week");
    expect(weekMilestoneFor("base", null, [completed(), completed("long")])).toBe("week");
  });

  it("stays null for a mostly-missed peak week", () => {
    expect(weekMilestoneFor("peak", null, [completed(), missed("long")])).toBeNull();
  });
});
