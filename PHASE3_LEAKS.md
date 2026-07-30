# Phase 3 leak audit: 37 confirmed cross-user leaks

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
