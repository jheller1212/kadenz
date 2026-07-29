import { test, expect, type Page } from "@playwright/test";
import { clearTodaysStrengthSessions } from "../helpers";

// Both specs start a fresh session, read the overview, then go Back — which
// deletes the ad-hoc session it just created (see strength/page.tsx
// backToPicker) — so the next start on the same programme type is genuinely
// fresh rather than "adopting" the one just created.
//
// The final Back of each test fires that delete and the test then ends, so the
// browser context can be torn down before the request lands. Clearing today's
// planned sessions around each test means one dropped delete can't turn into a
// permanently poisoned database: without it, the leftover session gets adopted
// on the next run, the duration override never applies, and the estimate
// assertion below fails for reasons that have nothing to do with durations.

async function startSession(
  page: Page,
  type: "full_body" | "upper" | "lower",
  opts?: { duration?: 30 | 45 | 60; equipment?: "home" | "box" | "full_gym" }
) {
  await page.getByTestId(`kraft-programme-card-${type}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  if (opts?.duration) {
    await page.getByTestId(`kraft-duration-${opts.duration}`).click();
  }
  if (opts?.equipment) {
    await page.getByTestId(`kraft-equipment-${opts.equipment}`).click();
  }
  await page.getByTestId("kraft-start-session").click();
  await expect(page.getByTestId("kraft-overview-estimate")).toBeVisible();
}

async function exerciseSlugs(page: Page): Promise<string[]> {
  const items = page.locator('[data-testid^="kraft-exercise-"]');
  const count = await items.count();
  const slugs: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await items.nth(i).getAttribute("data-testid");
    if (testId) slugs.push(testId.replace("kraft-exercise-", ""));
  }
  return slugs;
}

async function backToPicker(page: Page) {
  await page.getByTestId("kraft-overview-back").click();
  await expect(page.getByTestId("kraft-programme-list")).toBeVisible();
}

test.describe("Kraft session start options", () => {
  test.beforeEach(async ({ page }) => {
    await clearTodaysStrengthSessions(page);
  });

  test.afterEach(async ({ page }) => {
    await clearTodaysStrengthSessions(page);
  });

  test("a duration chip changes the exercise list and moves the estimate toward the budget", async ({ page }) => {
    await page.goto("/strength");

    await startSession(page, "full_body");
    const baselineEstimateText = await page.getByTestId("kraft-overview-estimate").innerText();
    const baselineEstimate = Number(baselineEstimateText.match(/\d+/)?.[0]);
    expect(Number.isFinite(baselineEstimate)).toBe(true);
    await backToPicker(page);

    await startSession(page, "full_body", { duration: 30 });
    const chosenEstimateText = await page.getByTestId("kraft-overview-estimate").innerText();
    const chosenEstimate = Number(chosenEstimateText.match(/\d+/)?.[0]);
    expect(Number.isFinite(chosenEstimate)).toBe(true);

    // Moved toward the 30-minute budget: strictly shorter than the unbudgeted
    // baseline, and inside the window fitSessionToDuration promises — at or
    // under the budget, and no more than DURATION_TOLERANCE (20%) under it, so
    // a session trimmed down to almost nothing fails here too.
    expect(chosenEstimate).toBeLessThan(baselineEstimate);
    expect(chosenEstimate).toBeLessThanOrEqual(30);
    expect(chosenEstimate).toBeGreaterThanOrEqual(24);

    await backToPicker(page);
  });

  test("an equipment preset changes the generated exercises", async ({ page }) => {
    await page.goto("/strength");

    await startSession(page, "upper");
    const baselineSlugs = await exerciseSlugs(page);
    expect(baselineSlugs.length).toBeGreaterThan(0);
    await backToPicker(page);

    await startSession(page, "upper", { equipment: "home" });
    const homeSlugs = await exerciseSlugs(page);
    expect(homeSlugs.length).toBeGreaterThan(0);

    expect(homeSlugs).not.toEqual(baselineSlugs);

    await backToPicker(page);
  });
});
