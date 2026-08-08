import { test, expect } from "@playwright/test";

// Regression guard for #75 ("Make Kraft's strength surface fit more than one
// athlete"): the picker offers Full Body/Upper/Lower, and the three historic
// dedicated Achilles cards are gone — folded into these three instead.
//
// The seeded owner reports no complaints (see e2e/seed.ts, which leaves
// strengthPlanSettings.complaints unset on purpose so it can't change what
// every other Kraft spec's freshly-started session contains), so the Rehab
// card is correctly absent here. That gating is covered exactly, per
// complaint combination, by src/lib/strength/__tests__/picker.test.ts —
// this spec's job is that the list renders and offers nothing historic.
test.describe("Kraft picker", () => {
  test("shows the three standard programme cards, and no historic Achilles card", async ({
    page,
  }) => {
    await page.goto("/strength");

    const list = page.getByTestId("kraft-programme-list");
    await expect(list).toBeVisible();

    const cards = list.locator("button");
    await expect(cards).toHaveCount(3);

    await expect(page.getByTestId("kraft-programme-card-full_body")).toBeVisible();
    await expect(page.getByTestId("kraft-programme-card-upper")).toBeVisible();
    await expect(page.getByTestId("kraft-programme-card-lower")).toBeVisible();

    // Rehab is offered only to an athlete who reports the Achilles complaint
    // (lib/strength/picker.ts pickerTypesFor); this seeded athlete does not.
    await expect(page.getByTestId("kraft-programme-card-achilles")).toHaveCount(0);

    // The combo types are historic: reachable from an existing session, never
    // offered fresh from the picker for anyone.
    await expect(page.getByTestId("kraft-programme-card-upper_achilles")).toHaveCount(0);
    await expect(page.getByTestId("kraft-programme-card-lower_achilles")).toHaveCount(0);
  });
});
