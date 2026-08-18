import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createCronBudget, runWithinBudget } from "../budget";

// The bug these pin, in the shape it actually shipped in:
//
// /api/cron/sync-drain carried a 120s budget and still died on Vercel's hard
// 300s FUNCTION_INVOCATION_TIMEOUT, over and over, for weeks. The budget was
// checked only BETWEEN users — which bounds how many users start and says
// nothing about how long one takes. With a single user in the database the
// check ran once, at 0ms elapsed, and never again.
//
// It went unnoticed because nothing about it looks unbounded: the Garmin
// worker allows ~10s per request, every request obeyed that, and a healthy
// run finished in 6-8 seconds. But the drain claims up to 50 jobs, so an
// unreachable worker costs up to 500s of individually well-behaved calls.

describe("createCronBudget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports what is left, not just whether it is spent", () => {
    const budget = createCronBudget(1000);
    expect(budget.remainingMs()).toBe(1000);
    vi.advanceTimersByTime(400);
    expect(budget.remainingMs()).toBe(600);
    expect(budget.exceeded()).toBe(false);
  });

  it("floors at zero rather than going negative once spent", () => {
    const budget = createCronBudget(1000);
    vi.advanceTimersByTime(5000);
    expect(budget.remainingMs()).toBe(0);
    expect(budget.exceeded()).toBe(true);
  });
});

describe("runWithinBudget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the value when the work finishes in time", async () => {
    const budget = createCronBudget(1000);
    const promise = runWithinBudget(budget, async () => "done");
    await expect(promise).resolves.toEqual({ timedOut: false, value: "done" });
  });

  it("gives up on a single unit that outlives the budget", async () => {
    // The whole point: ONE unit, so the between-units check never gets a turn.
    const budget = createCronBudget(1000);
    const promise = runWithinBudget(
      budget,
      () => new Promise((resolve) => setTimeout(() => resolve("too late"), 60_000))
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ timedOut: true });
  });

  it("bounds by what REMAINS, not the full budget", async () => {
    // Second user in a fan-out must not get a fresh 120s — otherwise N users
    // each get the full budget and the total is unbounded again.
    const budget = createCronBudget(1000);
    vi.advanceTimersByTime(800);
    const promise = runWithinBudget(
      budget,
      () => new Promise((resolve) => setTimeout(() => resolve("too late"), 60_000))
    );
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toEqual({ timedOut: true });
  });

  it("does not start work at all once the budget is spent", async () => {
    const budget = createCronBudget(1000);
    vi.advanceTimersByTime(2000);
    const fn = vi.fn(async () => "should not run");
    await expect(runWithinBudget(budget, fn)).resolves.toEqual({ timedOut: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("propagates a throw rather than reporting it as a timeout", async () => {
    // A failing unit and an overrunning unit are different outcomes: one is a
    // job to retry, the other is a truncated pass. Collapsing them would hide
    // real errors behind "truncated".
    const budget = createCronBudget(1000);
    await expect(
      runWithinBudget(budget, async () => {
        throw new Error("drain blew up");
      })
    ).rejects.toThrow("drain blew up");
  });
});
