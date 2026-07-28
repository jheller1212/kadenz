import { describe, expect, it } from "vitest";
import { needsStrengthSetupPrompt } from "../setup-prompt";

describe("needsStrengthSetupPrompt", () => {
  it("shows the prompt when there is no plan settings row (null)", () => {
    expect(needsStrengthSetupPrompt(null)).toBe(true);
  });

  it("shows the prompt when the fetch hasn't resolved yet (undefined)", () => {
    expect(needsStrengthSetupPrompt(undefined)).toBe(true);
  });

  it("hides the prompt once a settings row exists, even with empty equipment", () => {
    expect(needsStrengthSetupPrompt({ equipment: [], complaints: [] })).toBe(false);
  });

  it("hides the prompt for a fully configured row", () => {
    expect(
      needsStrengthSetupPrompt({ equipment: ["dumbbell", "bench"], complaints: ["achilles"] })
    ).toBe(false);
  });
});
