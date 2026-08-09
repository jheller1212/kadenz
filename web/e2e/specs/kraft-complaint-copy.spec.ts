import { test, expect } from "@playwright/test";
import { STRENGTH_COMPLAINTS, COMPLAINT_LABELS } from "../../src/lib/strength/types";
import { TARGETED_WORK, EXERCISE_BY_SLUG } from "../../src/lib/strength/program";

// Kraft settings is where an athlete decides what their sessions contain, so
// the copy under each complaint is a promise about the training they are about
// to do. #171 changed a complaint from one exercise to a progression of 2-4,
// which changed that copy and the code behind it — this checks the screen
// actually renders it, in a browser.
//
// Deliberately READ-ONLY: no toggle is touched. e2e/seed.ts leaves the owner's
// complaints unset on purpose, because setting one changes what every other
// Kraft spec's freshly-started session contains (see the comment in
// ensureRehabWeekFixtures). The stacking behaviour those toggles drive is
// covered exhaustively by src/lib/strength/__tests__/injury-aware.test.ts,
// where it can be tested per combination without a shared database.

test.describe("Kraft settings complaint copy", () => {
  test("every complaint names the exercises it adds", async ({ page }) => {
    await page.goto("/settings/kraft");

    for (const complaint of STRENGTH_COMPLAINTS) {
      await expect(
        page.getByText(COMPLAINT_LABELS[complaint], { exact: true }),
        `${complaint} row is missing`
      ).toBeVisible();
    }

    // The non-Achilles complaints each state a count and list the exercises.
    // Asserting against TARGETED_WORK rather than hardcoded strings means
    // adding an exercise to a complaint can't leave this spec passing while
    // the screen under-reports what the session will contain.
    for (const complaint of STRENGTH_COMPLAINTS) {
      if (complaint === "achilles") continue;
      const names = TARGETED_WORK[complaint]!.exercises
        .map((e) => EXERCISE_BY_SLUG[e.slug]?.name)
        .filter((n): n is string => !!n);
      expect(names.length, `${complaint} has no named exercises`).toBeGreaterThanOrEqual(2);

      await expect(
        page.getByText(`Adds ${names.length} exercises to lower and full body days:`, { exact: false }).first()
      ).toBeVisible();
      for (const name of names) {
        await expect(
          page.getByText(name, { exact: false }).first(),
          `${complaint} does not mention ${name}`
        ).toBeVisible();
      }
    }
  });

  test("the Achilles row still describes its own protocol", async ({ page }) => {
    // Achilles is not part of TARGETED_WORK — it has its own HSR block and its
    // own copy, which #171 must not have disturbed.
    await page.goto("/settings/kraft");
    await expect(page.getByText(/Adds \d+ exercises:/).first()).toBeVisible();
  });
});
