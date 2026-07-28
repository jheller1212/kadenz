# Plan of attack: moving Kadenz to multiple users

Goal: get real people other than the owner using Kadenz, safely, without a
rewrite and without a window where one user can see another's data.

Measured surface as of 2026-07-28 (`origin/main`): 22 tables, 77 API routes,
65 files importing the database, 62 `db.select/insert/update/delete` call
sites. Driver is `postgres-js` over a pooled Neon endpoint.

---

## The one decision that shapes everything

There are two ways to make queries user-safe.

**Filter in application code.** Add `where(eq(table.userId, currentUser))` to
all 62 call sites, then keep doing that forever in every new query. Every miss
is a data leak, and it fails **open**: forget the clause and the query happily
returns everyone's rows.

**Enforce in Postgres with row level security.** Turn RLS on per table, set
`app.user_id` once per request, and let the database refuse to return rows
that do not belong to the caller. A forgotten filter returns nothing instead
of everything. It fails **closed**.

**Take the second.** It is the difference between a migration you can finish
and an audit you can never stop doing. The 62 call sites still get their
filters for clarity and index use, but correctness no longer depends on
remembering.

One implementation detail that must not be got wrong: the app talks to Neon
through a **transaction pooler**, so a bare `SET app.user_id` would leak into
whatever request reuses that connection next. The context must be set with
`SET LOCAL` **inside an explicit transaction**, so it dies with the
transaction. Every request that touches the database therefore runs inside a
transaction opened by one shared helper. That helper is the whole safety
model, so it gets written once and reviewed hard.

---

## Testing with many users does not require public signup

`KADENZ_ALLOWED_STRAVA_ATHLETE_IDS` and `KADENZ_ALLOWED_GOOGLE_EMAILS` are
**already lists**. Adding a tester's Strava id or Google email to the env var
is a complete invite mechanism.

So the beta needs Phases 1 to 3 only. Signup UI, password reset and the rest
of a public product (Phase 6) can wait until the model is proven with real
testers. This is the shortest path to the actual goal.

---

## Phases

Each phase is a PR or a small series, each leaves the app working, and each is
independently revertible. Do not start a phase before the one above it is
merged and live.

### Phase 0: prerequisites (no code)
- **Upgrade Neon.** The free tier autosuspends after 5 minutes, which already
  causes the measured 2.5s cold start for one user. It is not a plan you can
  put testers on.
- Decide how many testers, and confirm they all have a Strava or Google
  account, since that is currently the only way in.

### Phase 1: real identity (no behaviour change)
- `users` table: id, provider, provider account id, email, display name,
  created_at.
- On OAuth callback, upsert the user and put **their id** in the signed
  session cookie instead of the literal string `"authenticated"`.
- Keep the allowlist exactly as it is. Nothing opens up yet.
- Backfill: the owner becomes user 1.
- Old cookies are invalidated by this, so it logs the owner out once. Say so.

**Done when:** the owner logs in, everything behaves identically, and the
session carries a real user id.

### Phase 2: tenancy columns (additive, still single user in practice)
- Add `user_id` to the 13 tables that have no tenancy today: `plans`, `weeks`,
  `workouts`, `blocks`, `activities`, `deleted_activities`, `activity_trash`,
  `personal_records`, `sync_outbox`, `wellness_metrics`, `push_subscriptions`,
  `reminder_settings`, `sent_reminders`.
- Add `user_id` to the four already profile-scoped tables, since a profile
  belongs to a user: `strength_sessions`, `wellness_logs`,
  `strength_plan_settings`, `custom_workout_templates`. Also to `profiles`
  itself.
- Backfill every existing row to user 1. This is the one migration that
  rewrites data, so it is written idempotently, verified on a branch database
  first, and run when nobody is training.
- Then make the columns `NOT NULL`.
- `reminder_settings` stops being a singleton. Its comment says as much today.

**Done when:** every row has an owner and the app still works unchanged.

### Phase 3: enforcement (the phase that actually makes it safe)
- One `withUser(userId, fn)` helper opening a transaction and issuing
  `SET LOCAL app.user_id`.
- RLS enabled on every tenanted table, with a policy comparing `user_id` to
  `current_setting('app.user_id')`.
- Route all database access through the helper. This is the change that
  touches many of the 65 files, but it is mechanical and the database is
  backstopping it.
- Add the filters at the 62 call sites too, for index use and readability.

**Done when the leak test passes** (see below). This is the gate for letting a
second person in.

### Phase 4: per-user integrations
- Strava, Google and Garmin tokens move from one stored credential set
  (`saveTokens()` in `strava-client.ts` and `gcal-client.ts`) to per-user rows.
- Each user connects their own accounts, or connects none and enters workouts
  by hand.
- Decide explicitly what a user with no Garmin sees on the readiness card. The
  existing warm-up state is the honest answer.

### Phase 5: per-user background work
- Reminders, sync drain and the wellness pull currently assume one athlete.
  They become loops over users.
- This changes the cost profile: the Cloudflare Worker fires every 5 minutes,
  and each run now does work proportional to the number of users. Fine for
  tens of testers, needs a queue well before thousands.

### Phase 6: public product (only if going beyond invite-only)
- Signup, account deletion including a real GDPR erase, privacy policy, a
  support path, and a decision about who pays for the compute.

---

## The test that gates the beta

Not a review checklist, an automated test that fails the build:

1. Seed two users, each with a plan, workouts, activities, strength sessions
   and wellness rows.
2. For every route under `web/src/app/api/`, call it as user B using user A's
   resource ids.
3. Assert the response is 404 or 403 and **never** contains user A's data.
4. Separately, assert every table carrying `user_id` has RLS enabled, by
   querying `pg_tables`. A new table without a policy fails the build rather
   than quietly leaking.

Point 4 is what stops this decaying six months from now.

---

## Risks, stated plainly

- **Phase 2 rewrites data.** It is the only step that does. Take a Neon branch
  first and rehearse against it.
- **Phase 1 logs the owner out.** Trivial, but surprising if unannounced.
- **RLS makes mistakes silent.** A wrong policy returns an empty list, not an
  error. The leak test is what catches that; without it, Phase 3 is guesswork.
- **Cost stops being free** at Phase 0 and grows at Phase 5.
- **Health data raises the stakes.** Sleep, HRV and resting heart rate for
  strangers is not the same as for yourself. Phase 6 is where that has to be
  answered properly, and it is a reason to stay invite-only for a while.

---

## Recommended order of work

Phase 0 now, since it is a purchase rather than code. Then 1, 2 and 3 back to
back, because a half-done tenancy model is worse than either endpoint. Then
invite two or three real testers and leave it there for a few weeks. Phases 4
and 5 respond to what those testers actually hit. Phase 6 only if the answer
is yes, this should be a product.
