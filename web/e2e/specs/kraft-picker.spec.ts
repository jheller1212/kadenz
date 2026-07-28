import { test, expect } from "@playwright/test";

// Regression guard for #75 ("Make Kraft's strength surface fit more than one
// athlete"): the picker offers exactly Full Body/Upper/Lower — the three
// historic dedicated Achilles cards are gone, folded into these three
// instead — for an athlete with no reported complaints.
test.describe("Kraft picker", () => {
  test("shows exactly three programme cards, no dedicated Achilles card", async ({ page }) => {
    await page.goto("/strength");

    const list = page.getByTestId("kraft-programme-list");
    await expect(list).toBeVisible();

    const cards = list.locator("button");
    await expect(cards).toHaveCount(3);

    await expect(page.getByTestId("kraft-programme-card-full_body")).toBeVisible();
    await expect(page.getByTestId("kraft-programme-card-upper")).toBeVisible();
    await expect(page.getByTestId("kraft-programme-card-lower")).toBeVisible();

    // No dedicated Achilles card — those historic types (achilles,
    // upper_achilles, lower_achilles) are only ever reachable via an
    // existing/historic session, never offered fresh from the picker.
    await expect(page.getByTestId("kraft-programme-card-achilles")).toHaveCount(0);
    await expect(page.getByTestId("kraft-programme-card-upper_achilles")).toHaveCount(0);
    await expect(page.getByTestId("kraft-programme-card-lower_achilles")).toHaveCount(0);
  });
});
