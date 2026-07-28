import { test, expect } from "@playwright/test";

// A smoke pass over every bottom-nav tab: each must render without an
// uncaught page error and without a spinner stuck open forever. This is the
// harness's answer to "no agent can click through the UI" — the app has
// never been exercised in a real browser before this suite.
const TABS: Array<{ id: string; href: string }> = [
  { id: "today", href: "/" },
  { id: "plan", href: "/plan" },
  { id: "strength", href: "/strength" },
  { id: "activities", href: "/activities" },
  { id: "stats", href: "/stats" },
];

for (const tab of TABS) {
  test(`${tab.id} tab renders without an error or a stuck spinner`, async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto(tab.href);

    const nav = page.getByTestId("bottom-nav");
    await expect(nav).toBeVisible();
    await expect(page.getByTestId(`nav-tab-${tab.id}`)).toHaveAttribute("aria-current", "page");

    // Let in-flight fetches resolve, then require every spinner to have
    // cleared — a spinner still spinning after this is "stuck", not "loading".
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[role="status"][aria-label="Loading"]')).toHaveCount(0);

    expect(pageErrors, `unexpected page errors on ${tab.href}: ${pageErrors.map((e) => e.message).join("; ")}`).toEqual([]);
  });
}
