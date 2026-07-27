import { describe, expect, it } from "vitest";
import { completesOnRecord } from "../workout-record";

describe("completesOnRecord", () => {
  it("marks a normal run complete on GPS record — the common case must not regress", () => {
    expect(completesOnRecord("easy")).toBe(true);
    expect(completesOnRecord("long")).toBe(true);
    expect(completesOnRecord("tempo")).toBe(true);
    expect(completesOnRecord("interval")).toBe(true);
    expect(completesOnRecord("recovery")).toBe(true);
  });

  it("does not complete a race on GPS record — it waits for the deliberate result log", () => {
    expect(completesOnRecord("race")).toBe(false);
  });
});
