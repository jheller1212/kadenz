import { test, expect, type Page } from "@playwright/test";
import { clearTodaysStrengthSessions } from "../helpers";

// Coverage for chaining (#165): "I've got an hour — Upper, then Lower".
//
// The unit tests cover what applyExerciseOverrides does with an "added"
// override. What they cannot cover is the promise the feature actually makes
// to the athlete: that the second block is still there after a reload. That
// promise spans the sheet, the PATCH, the stored override column and the
// rebuild-from-template read path, and it is the one thing that was broken in
// the pre-existing "Add exercise" flow (a plain add is deliberately ephemeral
// — see strength/page.tsx persistExerciseOrder). So it is asserted here, in a
// real browser, against a real database.
//
// Same fresh-session hygiene as kraft-duration-equipment.spec.ts: each test
// starts its own session and clears today's sessions around itself, so a
// dropped delete can't poison the next run by leaving a session to adopt.

async function startSession(page: Page, type: "full_body" | "upper" | "lower") {
  await page.getByTestId(`kraft-programme-card-${type}`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("kraft-start-session").click();
  await expect(page.getByTestId("kraft-overview-estimate")).toBeVisible();
}

async function exerciseSlugs(page: Page): Promise<string[]> {
  const items = page.locator('[data-testid^="kraft-exercise-"]');
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  const slugs: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await items.nth(i).getAttribute("data-testid");
    if (testId) slugs.push(testId.replace("kraft-exercise-", ""));
  }
  return slugs;
}

async function addBlock(page: Page, type: "full_body" | "upper" | "lower", minutes: 30 | 45 | 60) {
  await page.getByTestId("kraft-add-block").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId(`kraft-chain-duration-${minutes}`).click();
  await page.getByTestId(`kraft-chain-block-${type}`).click();
  // The sheet closes only once the PATCH has landed (addBlock awaits it), so
  // waiting on that is what makes the reload below meaningful rather than a
  // race against an in-flight request.
  await expect(page.getByRole("dialog")).toBeHidden();
}

test.describe("Chaining a second block onto today's session", () => {
  test.beforeEach(async () => {
    await clearTodaysStrengthSessions();
  });
  test.afterEach(async () => {
    await clearTodaysStrengthSessions();
  });

  test("adds the second block's exercises, and they survive a reload", async ({ page }) => {
    await page.goto("/strength");
    await startSession(page, "upper");

    const before = await exerciseSlugs(page);
    expect(before.length).toBeGreaterThan(0);

    await addBlock(page, "lower", 30);

    const after = await exerciseSlugs(page);
    expect(after.length).toBeGreaterThan(before.length);
    // Everything that was there is still there, in place — chaining appends,
    // it never rebuilds the session the athlete already chose.
    expect(after.slice(0, before.length)).toEqual(before);

    // The point of the whole feature. Reload lands back on the picker (the
    // overview is not a route), so this walks the path the athlete actually
    // walks: reopen the programme, which adopts today's existing session and
    // rebuilds its plan from the template plus the stored overrides. A plain
    // "Add exercise" would be gone by here — that layer is deliberately
    // ephemeral, which is exactly why chaining does not use it.
    await page.reload();
    await startSession(page, "upper");
    const reloaded = await exerciseSlugs(page);
    for (const slug of after) {
      expect(reloaded, `${slug} did not survive the reload`).toContain(slug);
    }
  });

  test("never prescribes the same lift twice when the two blocks overlap", async ({ page }) => {
    // Upper then Lower is the case that genuinely adds work; the assertion
    // that matters is that nothing in the combined list repeats.
    await page.goto("/strength");
    await startSession(page, "upper");
    await addBlock(page, "lower", 30);

    const slugs = await exerciseSlugs(page);
    expect(new Set(slugs).size, `duplicates in: ${slugs.join(", ")}`).toBe(slugs.length);
  });

  // Not covered here: the "this session already covers everything in X" path.
  // It needs a pair of blocks where one fully contains the other, and whether
  // that happens depends on the athlete's equipment, chosen length and phase —
  // it held for Full Body + a 30-minute Lower locally and did not in CI, on the
  // same code. The one pairing guaranteed to be fully covered, a block chained
  // onto its own type, is unreachable on purpose: the sheet omits the session's
  // current type. So there is no deterministic way to reach it from the UI, and
  // a test that only sometimes exercises its subject is worse than none.
  // targetedSlotsFor's dedup and applyExerciseOverrides' "don't prescribe the
  // same lift twice" are unit-tested directly instead.

  test("the chained session's estimate grows to match the work added", async ({ page }) => {
    // The athlete chose an hour's worth of work; the screen has to say so,
    // or the duration on Today and the watch would still claim the short one.
    await page.goto("/strength");
    await startSession(page, "upper");
    const before = Number((await page.getByTestId("kraft-overview-estimate").innerText()).match(/\d+/)?.[0]);
    expect(Number.isFinite(before)).toBe(true);

    await addBlock(page, "lower", 30);

    await expect
      .poll(async () =>
        Number((await page.getByTestId("kraft-overview-estimate").innerText()).match(/\d+/)?.[0])
      )
      .toBeGreaterThan(before);
  });
});
