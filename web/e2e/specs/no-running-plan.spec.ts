import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_DATABASE_URL } from "../env";
// Same lazy-singleton reason as e2e/helpers.ts: db reads this on first query,
// so setting it at import time is what makes a direct DB write from a spec work.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? E2E_DATABASE_URL;
import { db, plans } from "../../src/db/index";
import { withUser } from "../../src/db/with-user";
import { asUserId } from "../../src/lib/user-id";
import { OWNER_USER_ID } from "../../src/db/schema";

// ── Every tab, with no RUNNING plan ─────────────────────────────────────────
//
// The state the seed never produces and the app kept getting wrong. Kadenz has
// two independent plans, and for a long time "no running plan" was treated as
// "no plans": Today rendered "Ready to train?", the Plan tab rendered "Build
// your plan", and both did so while Kraft was scheduling sessions and pushing
// them to the athlete's watch.
//
// bottom-nav-smoke.spec.ts covers the same five tabs, but only ever with an
// active plan seeded, so every no-plan branch in the app — including the ones
// added to fix the above — has shipped without a browser ever loading it.
// This archives the plan first and walks the same five tabs.

const TABS: Array<{ id: string; href: string }> = [
  { id: "today", href: "/" },
  { id: "plan", href: "/plan" },
  { id: "strength", href: "/strength" },
  { id: "activities", href: "/activities" },
  { id: "stats", href: "/stats" },
];

test.beforeAll(async () => {
  await withUser(asUserId(OWNER_USER_ID), () =>
    db.update(plans).set({ status: "archived" }).where(eq(plans.status, "active"))
  );
});

test.afterAll(async () => {
  // Restored so this spec cannot change what the rest of the suite sees,
  // whichever order Playwright runs them in.
  await withUser(asUserId(OWNER_USER_ID), () =>
    db.update(plans).set({ status: "active" }).where(eq(plans.status, "archived"))
  );
});

for (const tab of TABS) {
  test(`${tab.id} tab renders with no running plan`, async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto(tab.href);

    await expect(page.getByTestId("bottom-nav")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // A stuck spinner here is the "nothing loads" report, reproduced.
    await expect(page.locator('[role="status"][aria-label="Loading"]')).toHaveCount(0);
    expect(pageErrors.map((e) => e.message)).toEqual([]);
  });
}
