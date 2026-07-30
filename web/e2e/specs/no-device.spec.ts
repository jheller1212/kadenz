import { test, expect } from "@playwright/test";
import { resetOwnerDeviceSetup, setOwnerDeviceSetup } from "../helpers";

// The athlete with no watch, no Strava and no Garmin. Their whole experience
// is manual entry, and the app has to be honest about that rather than behave
// as though hardware is on its way.
//
// e2e/seed.ts gives the owner 5 nights of wellness_metrics, fewer than the 21
// the recovery baseline needs. That makes this suite the exact shape of the
// bug: before this feature, an athlete with no device still saw "building your
// recovery baseline (5/21 days)", counting toward a number that could never
// arrive because nothing was ever going to write night 6.
test.describe("No device", () => {
  test.beforeEach(async () => {
    // Answered, with nothing selected. Not the same as never asked.
    await setOwnerDeviceSetup([]);
  });

  test.afterEach(async () => {
    // readiness-warmup.spec.ts asserts the warm-up copy IS visible, and specs
    // share one database on one worker, so this must not leak.
    await resetOwnerDeviceSetup();
  });

  test("readiness names the check-in and never claims a baseline is building", async ({ page }) => {
    await page.goto("/");

    const card = page.getByTestId("readiness-card");
    await expect(card).toBeVisible();

    // A real score, not an empty state: the seeded check-in is enough on its own.
    await expect(page.getByTestId("readiness-score")).toBeVisible();
    await expect(page.getByTestId("readiness-band")).toBeVisible();

    // The bug this spec exists for.
    await expect(page.getByTestId("readiness-physiology-warmup")).toHaveCount(0);

    // And the card says what it is actually scoring from.
    await expect(page.getByTestId("readiness-manual-source")).toBeVisible();
  });

  test("connected apps offers nothing that cannot be connected", async ({ page }) => {
    await page.goto("/settings/apps");

    // Apple Health has no web API, so it is shown with a reason rather than as
    // a control that would do nothing when tapped. A dead toggle is worse than
    // an absent one, so assert it is genuinely not interactive.
    const appleHealth = page.getByTestId("connection-unavailable-apple-health");
    await expect(appleHealth).toBeVisible();
    expect(await appleHealth.evaluate((el) => el.tagName.toLowerCase())).not.toBe("button");
    expect(await appleHealth.locator("button, a, input").count()).toBe(0);

    // And the screen reflects the athlete's actual choice instead of reading
    // like a list of things they have failed to set up.
    await expect(page.getByTestId("settings-manual-entry-card")).toBeVisible();
  });
});
