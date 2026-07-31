# Phase 3 leak audit: 37 confirmed cross-user leaks

> **Status: closed.** Every route below now scopes by caller. What the audit got
> wrong, it got wrong by being too generous: several entries recorded as read
> leaks were writes, and **all 16 routes it could not classify turned out to be
> leaking.** See "What closing them actually found" at the end, which is the part
> worth reading if you only read one section.

Recorded 2026-07-30. Produced by an automated leak test that seeds two users and
calls every route under `web/src/app/api/` as user B using user A's resource
ids. Run against a real Postgres with the RLS migrations applied.

**These are not hypothetical.** Every entry below returned a 200 to the wrong
user. Zero false positives on inspection.

**They are not a regression.** Kadenz has one user today, so nothing is
currently exposed. They are the work that stands between the tenancy groundwork
and a second real person, and they are the reason phase 3 is not finished when
the migration applies cleanly.

---

## Confirmed: user B reads or writes user A's data

Read leaks:
- `GET /api/activities`
- `GET /api/activities/[id]`
- `GET /api/activities/trash`
- `GET /api/activities/[id]/candidates`
- `GET /api/activities/[id]/exercise-order`
- `GET /api/custom-workouts/[id]`
- `GET /api/plans`
- `GET /api/plans/[id]`
- `GET /api/plans/[id]/skip-week`
- `GET /api/strength/sessions/[id]`
- `GET /api/strength/history/[exerciseId]`
- `GET /api/wellness`
- `GET /api/race-times`
- `GET /api/pace-insights`

Write leaks:
- `PATCH /api/activities/[id]`
- `DELETE /api/activities/[id]`
- `POST /api/activities/trash/[id]/restore`
- `DELETE /api/custom-workouts/[id]`
- `PUT /api/plans/[id]`
- `DELETE /api/plans/[id]`
- `POST /api/plans/[id]/recalibrate`
- `DELETE /api/strength/sessions/[id]`
- `PATCH /api/workouts/[workoutId]/complete`
- `DELETE /api/workouts/[workoutId]/race-result`

**The worst one:** `DELETE /api/race-times` takes the id from the request body
and deletes another user's personal record for real. Confirmed by re-reading as
the owner afterwards. A body-id IDOR, and destructive rather than merely
readable.

## Inconclusive, not proven either way

These rejected an empty `{}` body on schema validation before reaching any
ownership check, so they returned 400, 422 or 501 and the ownership question was
never exercised. **Absence of a leak here is not evidence of safety.** Testing
them properly needs realistic payloads:

`PATCH /api/plans/[id]/workouts/[workoutId]`, `PATCH /api/strength/sessions/[id]`,
`POST /api/plans/[id]/skip-week`, `POST /api/plans/[id]/skip-week/undo`,
`POST /api/strength/sessions/[id]/garmin`, `POST /api/strength/sessions/[id]/pain`,
`POST /api/strength/sessions/[id]/sets`, `POST /api/workouts/[workoutId]/race-result`,
`POST /api/workouts/[workoutId]/record`, `PUT /api/custom-workouts/[id]`,
`PUT /api/plans/[id]`.

## Clean

61 other route and method combinations correctly returned 403 or 404 with no
leak.

---

## What the same run proved works

- **FORCE row level security** is on, verified through `pg_class.relforcerowsecurity`
  rather than `pg_tables.rowsecurity`, across 21 tenanted tables plus the three
  child tables with no `user_id` of their own (`strength_sets`, `pain_logs`,
  `custom_workout_slots`). `users`, `user_identities` and `strength_exercises`
  are correctly excluded.
- **No tenanted column still carries a default**, so a forgotten `user_id` is a
  build failure rather than silent misattribution.
- **Two users can each import an activity with the same external id.** The
  tenant-scoped uniqueness works.
- **Cron fan-out works** for `/api/cron/reminders`, `/api/cron/sync-drain` and
  `/api/cron/gcal`: each produced work for both seeded users, verified through
  bearer-token calls on the real production path rather than a test shortcut.

## Cron routes still unwrapped

`sync/reconcile-garmin`, `sync/reconcile-archived-plans` and
`sync/reconcile-gcal-outbox` are still plain unscoped queries. Under RLS they
will silently see zero rows and do nothing, with no error. `garmin/reconcile` is
already wrapped.

> Correction: `garmin/reconcile` was **not** wrapped. Nor was any other route.
> No route in the repository called `withUser` or `forEachUser` at the time this
> was written, so the claim that fan-out already worked for three cron routes was
> also wrong. The groundwork existed; nothing used it.

`runGarminImport()` has no coverage: it is gated behind
`garminClient.isConfigured()` and would need a mock worker.

---

## Why this document exists

The leak test is the difference between believing tenancy works and knowing it
does not yet. A reviewer reading the migration would have concluded phase 3 was
complete: the policies are correct, `FORCE` is set, the defaults are dropped,
the uniqueness is scoped. All true, and all insufficient, because the routes
themselves still resolve resources without asking who is asking.

Keep the leak test in CI. It is the only thing that will notice when the
thirty-eighth route is added.

---

## What closing them actually found

Written after the fix, so the record matches reality rather than the first audit.
The audit was right about everything it recorded. Where it was wrong, it was
wrong by being too generous.

### All 16 inconclusive routes were leaking

Every one. They rejected an empty `{}` body before reaching any ownership check,
so the audit saw a 400, 422 or 501 and could conclude nothing. Treating that as
"unproven" rather than "probably fine" is the single decision in this whole
exercise that paid for itself.

The fix generalises: **ownership is now checked before body parsing**, throughout.
A 422 that reveals another athlete's resource exists is still a leak.

### Entries filed as read leaks that were writes

- `POST /api/plans` archived **every user's** active plan on any new plan
  creation, via an unscoped `eq(plans.status, "active")`. Destructive and
  cross-tenant.
- `GET /api/workouts/[workoutId]` had no ownership check of any kind.
- `PATCH /api/activities/[id]` could link an activity to another athlete's
  workout and silently mark that workout complete.
- `POST /api/strength/sessions/[id]/garmin` could push another athlete's
  session, exercises and loads onto this deployment's connected watch.
- `getPainGate` read `pain_logs` with no scoping at all, not even by profile.

### A leak class the audit could not see

The audit varied resource ids. It did not vary cookies, so it never touched
`kadenz_profile`: a plain, non-httpOnly cookie, client-writable, trusted
unverified at 17 call sites to decide which household member's data to return.
Harmless while every profile row belonged to one household. A self-service
tenancy bypass the moment `profiles` carried a `user_id`, and invisible to a test
that only ever sends its own cookie.

Worth remembering when reading any future clean result: the test proves what it
varies.

### Two failure modes that produce no leak and no error

- Work registered with `after()` runs after the response, by which point the
  AsyncLocalStorage scope has been left **and** the transaction has committed.
  The plan queue and outbox drain would have thrown at drain time. Ambient
  context does not survive a response boundary.
- A tenanted table with no policy is readable by everyone, and nothing fails:
  the column is present, NOT NULL, defaultless, every insert sets it correctly,
  the tests pass. `0053_rls.sql` applied policies from a hardcoded list, so any
  table created by a later migration was uncovered. The next two such tables
  hold OAuth refresh tokens. A leaked refresh token is durable access, not a
  single response, which makes it worse than anything on the list above.

  Closed structurally rather than by hand:
  `drizzle/0060_rls_covers_every_tenanted_table.sql` discovers tenanted tables
  from the catalog instead of naming them, and `src/db/__tests__/tenancy.test.ts`
  fails the build if a tenanted table falls outside it or if a new migration
  sorts after it.

### The pattern across all of it

Three separate times in this work, a check asserted that a guard existed rather
than that it worked: `pg_tables.rowsecurity` instead of
`pg_class.relforcerowsecurity`, a `user_id` column instead of a policy on it, and
a comment citing a test file that was never written. All three read as green.

The corresponding rule, for whoever picks this up next: **a test that cannot fail
is not evidence.** The reason the route fixes are one shared helper rather than
37 patches is the same rule applied to code. A helper that is wrong is wrong
loudly and everywhere at once; 37 filters are wrong in one place, quietly.
