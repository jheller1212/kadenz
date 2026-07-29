import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_DATABASE_URL } from "../env";

import { db, strengthSessions, strengthSets, strengthExercises } from "../../src/db/index";

// db is a lazy singleton (see src/db/index.ts) that only reads this on the
// first real query, so setting it here — after the import above but before
// any test runs — is safe, same pattern as e2e/seed.ts.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? E2E_DATABASE_URL;

// Regression coverage for the "unfinished session" prompt: a session with
// logged sets that never reached "completed" must surface an explicit
// Complete/Discard/Continue choice on return to the app, not stay silently
// invisible (see lib/strength/service.ts getExerciseHistoryBySlug and the
// resumeSnap card in src/app/strength/page.tsx). The card is driven by the
// client-side guided-session snapshot (localStorage), so this seeds a real
// "planned" session with logged sets in the DB and injects the matching
// snapshot the same shape GuidedSession itself would have saved.
test.describe("Unfinished Kraft session prompt", () => {
  test("offers Continue / Complete / Discard, and Complete marks the session done", async ({ page }) => {
    test.setTimeout(60_000);
    const [exercise] = await db
      .select({ id: strengthExercises.id, slug: strengthExercises.slug })
      .from(strengthExercises)
      .limit(1);
    expect(exercise).toBeTruthy();

    const date = new Date();
    const [session] = await db
      .insert(strengthSessions)
      .values({
        date,
        dayOfWeek: date.getDay(),
        type: "full_body",
        title: "Unfinished e2e session",
        status: "planned",
        watchEligible: false,
        startedAt: new Date(Date.now() - 10 * 60_000),
        endedAt: new Date(Date.now() - 5 * 60_000),
      })
      .returning({ id: strengthSessions.id });

    await db.insert(strengthSets).values({
      sessionId: session.id,
      exerciseId: exercise.id,
      setNumber: 1,
      weightKg: 20,
      reps: 10,
      kind: "working",
    });

    // Matches GuidedSnapshot (see lib/strength/guided-snapshot.ts) — only the
    // fields the resume card and resumeGuided() actually read are filled in.
    await page.addInitScript(
      ({ sessionId, slug }) => {
        localStorage.setItem(
          "kadenz_guided_session_v1",
          JSON.stringify({
            v: 1,
            savedAt: Date.now(),
            startedAt: Date.now() - 10 * 60_000,
            session: { id: sessionId, type: "full_body", title: "Unfinished e2e session", targetDurationMinutes: 40 },
            exercises: [],
            exIndex: 0,
            work: {
              [slug]: [
                { kg: 20, reps: 10, logged: true, durationSec: 12 },
                { kg: 20, reps: 10, logged: false, durationSec: 0 },
              ],
            },
          })
        );
      },
      { sessionId: session.id, slug: exercise.slug }
    );

    await page.goto("/strength");

    const prompt = page.getByTestId("unfinished-session-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt.getByText("1 of 2 sets logged")).toBeVisible();
    await expect(prompt.getByRole("button", { name: "Continue workout" })).toBeVisible();
    await expect(prompt.getByRole("button", { name: /Discard workout/ })).toBeVisible();

    await prompt.getByRole("button", { name: /Complete workout/ }).click();
    await expect(prompt).toHaveCount(0, { timeout: 20_000 });

    const [updated] = await db
      .select({ status: strengthSessions.status })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, session.id));
    expect(updated.status).toBe("completed");
  });
});
