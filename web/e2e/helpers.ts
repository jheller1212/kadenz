import { expect, type Page } from "@playwright/test";

/**
 * Removes every planned strength session dated today, through the app's own
 * API (same cookie, no back door).
 *
 * The seed deliberately contains no planned strength session for today, so
 * anything found here was created by a spec that started an ad-hoc session.
 * Specs share one database (see README), and a leftover session is not inert:
 * the Kraft picker adopts an existing planned session of the same type instead
 * of creating one, so a single leaked session makes every later "start a fresh
 * session" step silently reuse the old plan. Call this before and after any
 * spec that starts sessions.
 */
export async function clearTodaysStrengthSessions(page: Page) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  const res = await page.request.get(
    `/api/strength/sessions?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`
  );
  if (!res.ok()) return;
  const todays = (await res.json()) as Array<{ id: string; status: string }>;
  for (const s of todays) {
    if (s.status === "planned") await page.request.delete(`/api/strength/sessions/${s.id}`);
  }
}

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
