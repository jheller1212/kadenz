import { test, expect } from "@playwright/test";
import { eq, and } from "drizzle-orm";
import { E2E_DATABASE_URL } from "../env";
import { db, strengthSessions, OWNER_USER_ID } from "../../src/db/index";
import { withUser } from "../../src/db/with-user";
import { asUserId } from "../../src/lib/user-id";
import { strengthSessionUrl } from "../../src/lib/routes";

// db is a lazy singleton (see src/db/index.ts) that only reads this on the
// first real query — same pattern as e2e/seed.ts and kraft-unfinished-session.spec.ts.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? E2E_DATABASE_URL;

// Regression coverage for the rehab-visibility work: e2e/seed.ts's
// ensureRehabWeekFixtures gives the owner a sessionsPerWeek=4 target with
// only 3 sessions landing this week (one plain, one with the Achilles/HSR
// block attached, one standalone Rehab session). This asserts what the
// athlete actually sees for both — not just that the underlying data is
// correct, which the unit tests already cover.
//
// Filename is prefixed "0-" deliberately, not cosmetically: specs share one
// database and run in file order on a single worker (see e2e/helpers.ts),
// and two later specs perturb the exact fact this file checks —
// cross-user-isolation.spec.ts's tenanted-route probe calls
// POST /api/strength/plan-settings/reconcile for the owner, and
// kraft-unfinished-session.spec.ts leaves behind a real strength session
// dated today that changes this week's count. Both are upstream of "this
// week is genuinely 3 of 4" in normal alphabetical order; running first
// avoids depending on unrelated specs' side effects for a scenario that
// exists to test presentation, not scheduling.
test.describe("Rehab visibility and week-count honesty", () => {
  test("a standalone Rehab session reads as rehab on its own detail page, not as a mystery strength session", async ({
    page,
  }) => {
    // strength_sessions carries FORCE ROW LEVEL SECURITY (see
    // rls-coverage.spec.ts) — a bare db.select() with no user context set
    // matches no policy and silently returns nothing, same reason
    // kraft-unfinished-session.spec.ts wraps its insert in withUser.
    const [session] = await withUser(asUserId(OWNER_USER_ID), () =>
      db
        .select({ id: strengthSessions.id })
        .from(strengthSessions)
        .where(and(eq(strengthSessions.userId, OWNER_USER_ID), eq(strengthSessions.type, "achilles")))
        .limit(1)
    );
    expect(session, "seed.ts's standalone Achilles fixture should exist").toBeTruthy();

    await page.goto(strengthSessionUrl(session.id));
    // The page header and the overview card must both say "Rehab" — not the
    // literal stored title ("Rehab · Kraft"), not "Achilles" (the athlete-
    // facing word is "Rehab" everywhere, see docs/DESIGN.md), and not a bare
    // "Strength" that would make this indistinguishable from an ordinary day.
    await expect(page.getByText("Rehab", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Strength", { exact: true })).toHaveCount(0);
  });

  test("a session with the rehab block attached says so, instead of reading as a plain Upper day", async ({
    page,
  }) => {
    const [session] = await withUser(asUserId(OWNER_USER_ID), () =>
      db
        .select({ id: strengthSessions.id })
        .from(strengthSessions)
        .where(and(eq(strengthSessions.userId, OWNER_USER_ID), eq(strengthSessions.achillesAttached, true)))
        .limit(1)
    );
    expect(session, "seed.ts's Achilles-attached fixture should exist").toBeTruthy();

    await page.goto(strengthSessionUrl(session.id));
    await expect(page.getByText("Upper + Rehab", { exact: true }).first()).toBeVisible();
  });

  test("Today explains a strength week that falls short of the athlete's target instead of showing a bare number", async ({
    page,
  }) => {
    await page.goto("/");
    // The Strength row's reason line ("N of 4 this week — ...") only renders
    // when the scheduled count is under target — seed.ts deliberately leaves
    // this week at 3 of 4. Matches by substring since the exact reason
    // (part-elapsed vs. deload/taper vs. placement conflict) depends on
    // which weekday the suite happens to run on.
    await expect(page.getByText(/of 4 this week/)).toBeVisible();
  });
});
