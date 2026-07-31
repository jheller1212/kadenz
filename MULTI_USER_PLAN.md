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

## Background: why this is a re-foundation, not a feature

Kept from the earlier standalone assessment, which this document replaced.

## 2. What a second user actually requires

In dependency order. Each step is close to useless without the one before it.

1. **Real identity.** A `users` table, and a session that carries a user id
   rather than the string "authenticated". This is the change that touches
   `web/src/lib/session.ts`, `owner.ts`, and `proxy.ts`.
2. **Tenancy on every table listed above**, plus a `user_id` on the four
   already-profile-scoped tables, since a profile belongs to a user.
3. **Every query filtered by it.** This is the bulk of the work and the part
   most likely to leak data if done by hand. Roughly every route under
   `web/src/app/api/` and every helper in `web/src/lib/` that touches the
   database.
4. **Per-user OAuth tokens**, so two users can each connect their own Strava,
   Garmin and Calendar.
5. **Per-user cron.** Reminders, the sync drain and the wellness pull all
   currently assume one athlete. They become per-user loops, which changes
   their cost profile.
6. **Signup, account recovery, deletion.** Including a real GDPR delete, which
   the cascade work from the profile soft delete is a useful precedent for.

---

## 3. The honest costs

**This is not a feature, it is a re-foundation.** Step 3 alone means auditing
every data access path in the app. A missed filter is not a bug that shows up
as a broken page, it is one user seeing another user's data.

**Cost changes shape.** Today one athlete's data sits on Neon's free tier,
which already autosuspends and produces the cold start measured at 2.5s. Many
users means a paid database, per-user cron fan-out, and push volume that no
longer fits in a corner of the free tiers.

**Support and liability arrive with the second user.** Training data plus
health metrics (HRV, sleep, resting heart rate) is GDPR special-category
adjacent. A personal app that logs your own sleep is one thing. A service
holding strangers' sleep data is another, and it needs a privacy policy, a
deletion path and a breach plan.

---

## 4. The recommendation

**Do not start this incrementally in the dark.** A half-migrated tenancy model
is strictly worse than either endpoint: the queries that are filtered give a
false sense of safety while the unfiltered ones leak.

Two coherent options:

**A. Stay single-athlete, and make it excellent.** The app is genuinely good
at what it does for one person plus household guests. Everything shipped this
month (readiness from the watch, reliable reminders, Kraft generation that
adapts to equipment and injuries) has value without a second user existing.
The multi-user surface work still pays off here, because "not obviously
tailored to one person" is what makes the app feel finished.

**B. Commit to multi-user as a project**, done in the order above, with step 3
verified by a test that asserts every table with a tenancy column is filtered
on every read path, not by reviewer attention.

The work already done in that direction is real and is not wasted either way:
Kraft now generates from onboarding rather than from one athlete's injury, and
the profile model is honest about what it is.

**What this document deliberately does not do is start option B.** That is a
decision about what Kadenz is for, and it belongs to Jonas.

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
- One wrapper per route rather than a line copied into each handler:
  `withSession` (src/lib/api/with-session.ts) takes the user id from the signed
  cookie and opens the context; `requireOwned` (src/lib/api/owned.ts) resolves a
  row by id AND owner or answers 404. The copied-line version fails silently
  when someone forgets it, which is the one failure mode this phase cannot
  tolerate.

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
4. Separately, assert every table carrying `user_id` has RLS **forced**, by
   querying `pg_class.relforcerowsecurity`. A new table without a policy fails
   the build rather than quietly leaking.

Point 4 says `pg_class.relforcerowsecurity` and not `pg_tables.rowsecurity` for
a reason worth stating once. Postgres exempts a table's owner from that table's
policies, and Kadenz connects as the role that owns every table. So with
`ENABLE` alone the app keeps reading every user's rows while
`pg_tables.rowsecurity` reports true: the weaker column is true in both the safe
and the unsafe case, so asserting on it proves nothing. Only `FORCE` removes the
owner exemption.

Point 5, learned the hard way: the test must also assert that the same call
SUCCEEDS as the resource's owner. A route that answers 404 to everybody passes
an isolation test while being completely broken, and RLS mistakes present as
empty lists and blank screens rather than errors, so nothing else would notice.

Point 6: the test enumerates the route files on disk and fails on any route or
method it does not have a classification for. Without that, the next route
added is outside the test by default, which is how a suite like this decays.

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
