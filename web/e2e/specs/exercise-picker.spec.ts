import { test, expect, type Page } from "@playwright/test";
import { openExercisePicker } from "../helpers";

function resultSlugs(page: Page) {
  return page.locator('[data-testid^="exercise-picker-result-"]');
}

test.describe("Custom workout exercise picker", () => {
  test("typing a query filters the list", async ({ page }) => {
    await openExercisePicker(page);

    const fullCount = await resultSlugs(page).count();
    expect(fullCount).toBeGreaterThan(0);

    await page.getByTestId("exercise-picker-search").fill("curl");
    const filteredCount = await resultSlugs(page).count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(fullCount);
    await expect(page.getByTestId("exercise-picker-result-bicep_curl")).toBeVisible();
  });

  test("the Biceps filter chip returns curl exercises", async ({ page }) => {
    // Regression guard: these exercises only surface under a Biceps filter
    // because six exercises were reassigned off an "Arms" catch-all
    // primaryMuscle onto Biceps/Triceps — see lib/strength/muscle-groups.ts.
    await openExercisePicker(page);

    await page.getByTestId("exercise-picker-chip-Biceps").click();
    await expect(page.getByTestId("exercise-picker-result-bicep_curl")).toBeVisible();
    await expect(page.getByTestId("exercise-picker-result-hammer_curl")).toBeVisible();
  });

  test("clearing search and filter restores the full list", async ({ page }) => {
    await openExercisePicker(page);

    const fullCount = await resultSlugs(page).count();

    await page.getByTestId("exercise-picker-search").fill("curl");
    await page.getByTestId("exercise-picker-chip-Biceps").click();
    expect(await resultSlugs(page).count()).toBeLessThan(fullCount);

    await page.getByTestId("exercise-picker-clear").click();
    await expect(page.getByTestId("exercise-picker-search")).toHaveValue("");
    expect(await resultSlugs(page).count()).toBe(fullCount);
  });

  test("a nonsense query shows the empty state", async ({ page }) => {
    await openExercisePicker(page);

    await page.getByTestId("exercise-picker-search").fill("zzzzznonsensequery9999");
    await expect(page.getByTestId("exercise-picker-empty")).toBeVisible();
    expect(await resultSlugs(page).count()).toBe(0);
  });
});
