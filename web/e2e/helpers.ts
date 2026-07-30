import { expect, type Page } from "@playwright/test";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { E2E_DATABASE_URL } from "./env";
import { db, strengthSessions, strengthSets } from "../src/db/index";
import { OWNER_USER_ID, users } from "../src/db/schema";
import type { ConnectionId } from "../src/lib/device-setup";

// db is a lazy singleton (see src/db/index.ts) that only reads this on the
// first real query, so setting it at import time is safe — same pattern as
// e2e/seed.ts and kraft-unfinished-session.spec.ts.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? E2E_DATABASE_URL;

/**
 * Removes every strength session dated today, straight from the local e2e
 * database.
 *
 * The seed deliberately creates no strength session for today, so anything
 * found here was left behind by a spec. Specs share one database (see README)
 * and a leftover session is not inert: the Kraft picker adopts an existing
 * planned session of the same type instead of creating one, so a single leaked
 * session makes every later "start a fresh session" step silently reuse the old
 * plan, with the old plan's duration. Call this before and after any spec that
 * starts sessions.
 *
 * Deliberately not done through the app's API: the list endpoint is scoped to
 * the active profile cookie, which is only set once a page has loaded, so an
 * API-based cleanup running before the first navigation cannot see every
 * session a previous spec left behind. A test precondition needs to be
 * unconditional, and this is local throwaway data by construction (see
 * e2e/env.ts).
 *
 * Phase 3 of the multi-user plan needs to revisit this. It deliberately reads
 * and deletes every session dated today regardless of owner, which is right
 * for a test precondition. But it runs outside any HTTP request, so it will
 * have no per-request user context, and under row level security that means
 * the policy hides every row: the selects return nothing, the deletes remove
 * nothing, and the precondition silently stops holding while still passing.
 * It needs whatever escape hatch phase 3 gives trusted server-side work, and
 * a bare user filter is not it, because cleaning up only one user's sessions
 * is not what this is for.
 */
export async function clearTodaysStrengthSessions() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);

  const todays = await db
    .select({ id: strengthSessions.id })
    .from(strengthSessions)
    .where(and(gte(strengthSessions.date, dayStart), lte(strengthSessions.date, dayEnd)));
  if (todays.length === 0) return;

  const ids = todays.map((s) => s.id);
  await db.delete(strengthSets).where(inArray(strengthSets.sessionId, ids));
  await db.delete(strengthSessions).where(inArray(strengthSessions.id, ids));
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

/**
 * Sets the owner's answer to "which devices and apps do you want connected?".
 *
 * `connections: []` with a timestamp is the athlete who records by hand, and
 * that is a different state from never having been asked (see
 * lib/device-setup.ts). Written straight to the database for the same reason
 * as clearTodaysStrengthSessions above: a test precondition has to hold before
 * the first navigation, and the API needs a loaded page to carry the session.
 *
 * Every spec that calls this MUST call resetOwnerDeviceSetup afterwards. Specs
 * share one database and run in file order on a single worker, so leaving the
 * owner marked as a no-device athlete would suppress the readiness warm-up
 * copy that readiness-warmup.spec.ts asserts is visible.
 */
export async function setOwnerDeviceSetup(connections: ConnectionId[]) {
  await db
    .update(users)
    .set({ deviceSetupAt: new Date(), deviceConnections: connections })
    .where(eq(users.id, OWNER_USER_ID));
}

/** Puts the owner back to "never asked", the state e2e/seed.ts leaves. */
export async function resetOwnerDeviceSetup() {
  await db
    .update(users)
    .set({ deviceSetupAt: null, deviceConnections: [] })
    .where(eq(users.id, OWNER_USER_ID));
}
