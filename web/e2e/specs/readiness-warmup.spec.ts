import { test, expect } from "@playwright/test";

// e2e/seed.ts seeds 5 nights of wellness_metrics — fewer than
// MIN_BASELINE_NIGHTS (21, see lib/physiology.ts) — plus today's wellness
// check-in. Physiology has data but isn't trusted yet, so the card must show
// the warm-up message rather than pretend a 5-night baseline is confident.
test.describe("Readiness card", () => {
  test("shows the warm-up message instead of a confident physiology signal", async ({ page }) => {
    await page.goto("/");

    const card = page.getByTestId("readiness-card");
    await expect(card).toBeVisible();

    // The score still renders (there's a check-in, so it's not the "log a
    // check-in" empty state) — but physiology's contribution is withheld.
    await expect(page.getByTestId("readiness-score")).toBeVisible();
    await expect(page.getByTestId("readiness-physiology-warmup")).toBeVisible();
    await expect(page.getByTestId("readiness-physiology-warmup")).toContainText("5");
    await expect(page.getByTestId("readiness-physiology-warmup")).toContainText("21");
  });
});
