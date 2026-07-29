import { test, expect } from "@playwright/test";

// Regression guard for a real bug report: linking an activity to a strength
// session appeared to do nothing — the sheet closed (the PATCH succeeded)
// but the screen kept showing "Not linked to your plan". Root cause was on
// the read side, not the write: GET /api/activities/[id] only ever resolved
// `plannedWorkout` from `workoutId`, never from `strengthSessionId`, so a
// linked strength activity had nowhere to show as linked. A unit test on the
// PATCH handler alone would have stayed green through this bug — it needs a
// full reload of the detail screen to catch.
test.describe("Linking an activity to a strength session", () => {
  test("reflects on the screen immediately after linking, without a manual refresh", async ({ page }) => {
    // page.request is a separate cookie jar from the browser context and
    // drops the (secure-flagged) session cookie over plain http, so this
    // fetches through the actual page instead of page.request.
    await page.goto("/activities");
    const body = await page.evaluate(() => fetch("/api/activities").then((r) => r.json()));
    // The seed is idempotent and the local Postgres data dir persists across
    // suite re-runs, so a previous run of *this* test may have already
    // linked the seeded activity — its title becomes the linked session's
    // title ("Lower session") in that case, not the seeded activity name.
    // Match on durationSeconds/avgHr instead, which stay constant either way.
    const seeded = (
      body.activities as Array<{ id: string; title: string; durationSeconds: number; avgHr: number }>
    ).find((a) => a.durationSeconds === 1800 && a.avgHr === 128);
    expect(seeded, "seeded unlinked activity not found — check e2e/seed.ts").toBeTruthy();

    await page.goto(`/activity?id=${seeded!.id}`);

    // Reset to a known unlinked state before asserting anything — a previous
    // run of this same test may have left it linked.
    await page.evaluate(
      (id) =>
        fetch(`/api/activities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unlink: true }),
        }),
      seeded!.id
    );
    await page.reload();

    await expect(page.getByText("Not linked to your plan")).toBeVisible();

    await page.getByRole("button", { name: "Link to a workout" }).click();
    const candidate = page.getByRole("button", { name: /Lower session/ });
    await expect(candidate).toBeVisible();
    await candidate.click();

    // The sheet closes once the PATCH resolves — that part always worked.
    await expect(page.getByText("Not linked to your plan")).not.toBeVisible();

    // What was actually broken: the screen should now show the linked
    // session instead of silently staying on the unlinked prompt.
    await expect(page.getByText("Linked Session")).toBeVisible();
    await expect(page.getByRole("link", { name: /Lower session/ })).toBeVisible();
  });
});
