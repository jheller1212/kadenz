import { test, expect } from "@playwright/test";

// Regression guard for the bug this PR fixes: PR #87 added a `refresh: true`
// repair path to POST /api/strava/backfill, but nothing in the UI ever sent
// it, so a Strava-side edit (fixing a typo, correcting a distance) never
// reached Kadenz. These specs mock the network boundary — the seeded e2e
// account has no real Strava connection — and assert on the actual request
// body the button sends and the actual result text rendered, which is
// exactly the layer where a "shipped but unreachable" capability hides.

async function mockConnectedStatus(page: import("@playwright/test").Page) {
  await page.route("**/api/integrations/strava/status", (route) =>
    route.fulfill({ json: { connected: true } })
  );
}

test.describe("Strava sync in Connected Apps", () => {
  test("Sync last 30 days sends refresh:true and surfaces repaired count", async ({ page }) => {
    await mockConnectedStatus(page);

    let sentBody: unknown = null;
    await page.route("**/api/strava/backfill", async (route) => {
      sentBody = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ok: true,
          inserted: 0,
          alreadySynced: 3,
          refreshed: 1,
          remaining: 0,
          rateLimited: false,
          done: true,
          oldest: null,
        },
      });
    });

    await page.goto("/settings/apps");
    await page.getByTestId("strava-sync-button").click();

    const result = page.getByTestId("strava-sync-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("1 repaired");
    expect(sentBody).toEqual({ refresh: true });
  });

  test("Sync entire history sends full:true, not refresh, and omits the 30 day scope label", async ({
    page,
  }) => {
    await mockConnectedStatus(page);

    let sentBody: unknown = null;
    await page.route("**/api/strava/backfill", async (route) => {
      sentBody = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ok: true,
          inserted: 5,
          alreadySynced: 0,
          refreshed: 0,
          remaining: 0,
          rateLimited: false,
          done: true,
          oldest: "2024-01-10T08:00:00Z",
        },
      });
    });

    await page.goto("/settings/apps");
    await page.getByTestId("strava-sync-full-button").click();

    const result = page.getByTestId("strava-sync-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("5 new activities");
    await expect(result).not.toContainText("Last 30 days");
    expect(sentBody).toEqual({ full: true });
  });
});
