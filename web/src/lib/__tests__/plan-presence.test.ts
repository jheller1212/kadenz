import { describe, expect, it } from "vitest";
import { runPlanPresence, strengthPlanPresence, hasNoPlans } from "../plan-presence";

describe("plan presence", () => {
  it("reports a running plan as active", () => {
    expect(runPlanPresence({ id: "p1" })).toBe("active");
    expect(runPlanPresence(null)).toBe("none");
  });

  it("distinguishes a stopped Kraft plan from one that never existed", () => {
    // Different offers: "start again" versus "set up". Collapsing them loses
    // the settings the athlete already chose.
    expect(strengthPlanPresence({ active: false })).toBe("stopped");
    expect(strengthPlanPresence(null)).toBe("none");
    expect(strengthPlanPresence({ active: true })).toBe("active");
  });

  it("does not call the tab empty when only the running plan is missing", () => {
    // The bug, stated directly. Kraft active with no running plan is not an
    // empty screen — it is one plan running and one to offer.
    expect(hasNoPlans(null, { active: true })).toBe(false);
  });

  it("is empty only when neither plan is running", () => {
    expect(hasNoPlans(null, null)).toBe(true);
    expect(hasNoPlans(null, { active: false })).toBe(true);
    expect(hasNoPlans({ id: "p1" }, null)).toBe(false);
    expect(hasNoPlans({ id: "p1" }, { active: true })).toBe(false);
  });
});
