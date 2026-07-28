import { expect, type Page } from "@playwright/test";

/** Opens the custom workout builder's exercise picker, clicking through the
 *  first-run equipment step if it appears (fresh browser context = fresh
 *  localStorage, so it always appears in this suite). */
export async function openExercisePicker(page: Page) {
  await page.goto("/strength");
  await page.getByTestId("kraft-create-custom-workout").click();

  const equipmentStep = page.getByTestId("custom-workout-equipment-step");
  if (await equipmentStep.isVisible().catch(() => false)) {
    await page.getByTestId("custom-workout-equipment-continue").click();
  }

  await page.getByTestId("custom-workout-add-exercise").click();
  await expect(page.getByTestId("exercise-picker-results")).toBeVisible();
}
