# Kadenz plan of attack

**Start here.** This is the index. Everything open lives below, or behind one
of the links. Last updated 2026-08-01.

| Document | What it is |
|---|---|
| `MULTI_USER_PLAN.md` | Getting real testers onto Kadenz. Phased, with the tenancy decision. |
| `NATIVE_APP_PLAN.md` | App stores, and how Apple Health actually arrives. Depends on multi-user. |
| `KRAFT_DESIGN_BRIEF.md` | Paste-ready brief for Claude Design. Three Kraft screens. |
| `docs/DUPLICATION.md` | How this codebase fails, and how to catch the next one. |
| `docs/HANDOFF.md` | Strength module context from 11 July. Historical, partly superseded. |
| `docs/ROADMAP.md` | From April. Historical. Do not plan from it. |

---

## 1. Only Jonas can do these

- **Decide how migrations get permission to run. Nothing is broken today, but
  the next migration you write will silently not apply.** Every production
  deploy runs `scripts/migrate.mjs`, and on Supabase almost every file fails:

  ```
  [migrate] 0011_run_rpe.sql: FAILED at statement 1: must be owner of table workouts
  [migrate] 0014_strength_plan_settings.sql: FAILED: permission denied for schema public
  ```

  All 27 tables are owned by `postgres`. The app connects as `kadenz_app`,
  which is `NOBYPASSRLS` — correct, and the reason tenancy holds — but it
  therefore cannot run DDL. `migrate.mjs` never fails the build by design, so
  the deploy goes green regardless.

  **The current schema is fine.** Every migration through 0068 is applied,
  because the cutover ran the schema directly as `postgres`, and all 23
  tenanted tables have `relforcerowsecurity` set. This is a trap, not an
  outage: the failure only bites the next time a migration adds something the
  code depends on, and it will look like a passing deploy and a missing column.

  Two ways out, both needing a decision rather than a patch:

  1. **Give `kadenz_app` ownership** (`REASSIGN OWNED BY postgres TO
     kadenz_app` within `public`). Simplest, one connection string. Safe with
     respect to isolation: `FORCE ROW LEVEL SECURITY` applies to the table
     owner too, which is exactly why it is set, and `kadenz_app` stays
     `NOBYPASSRLS`. Recommended.
  2. **A separate privileged `MIGRATION_DATABASE_URL`** used only by the build
     step, with runtime still on `kadenz_app`. Keeps DDL rights out of the
     serverless runtime, but needs `ALTER DEFAULT PRIVILEGES` so tables a
     future migration creates are still reachable by the app — miss that and a
     new table is invisible to the app while every test passes.

  Whichever is chosen, once migrations can actually apply, make a failed
  migration fail the build. It cannot be done first: today that would block
  every deploy.

- **Delete the Neon project, once you are satisfied Supabase is solid.** The
  app moved to Supabase and Neon is now only a rollback copy, deliberately left
  untouched and therefore going stale by the day. Its connection string was
  pasted into a chat, so it should be treated as public: deleting the project
  is a cleaner end than rotating a password on a database nothing reads. Keep
  it until you have used the app for a week without surprises, then remove it.
  This also retires the free-tier 2.5s cold start that the old plan agonised
  over: Supabase does not autosuspend the way Neon did, so that whole line of
  investigation is closed.
- **Reconnect Google Calendar.** The OAuth grant is dead. Safe now that the 403
  stale queued jobs were cancelled.
- **Prompt Claude Design** with `KRAFT_DESIGN_BRIEF.md`.
- **Use the app and report what feels wrong.** Every bug found on 28 and 29
  July came from real use and was invisible to a passing test suite. This is
  not a formality. It is the most effective bug-finding channel the project
  has.

---

## 2. Next up, in order

### 2.1 Persist the customised exercise order
Dragging to reorder in the pre-start sheet updates local state only.
`handleStart` never sends it, and the session plan is re-derived from the
template on every read, so a custom order does not survive a resume or a
reload. `ExerciseOverride` on `strengthSessions.exerciseOverrides` supports
`removed` and `swapped` but has nothing for order.

The completed view now orders by first logged set, which is honest for a
finished session, but that is a workaround for a plan that was never stored.
Needs a schema change. **This is the clearest next piece of work.**

### 2.2 Strength activity detail screen
Sets with per-set heart rate, in the spirit of the run activity screen without
a map. The data already exists: `GET /api/strength/sessions/[id]` returns
`avgHr` and `maxHr` per set plus the linked activity summary. Only the screen
is missing.

Know what a per-set number means before designing around it: an average over a
window ending roughly when the set was logged, using the set's time under load
where known and a 30 second fallback otherwise. It is not a per-rep reading.

### 2.3 Screen transitions: the remaining tabs
The Today screen fired **nine** independent authenticated calls on mount, one
of them serially dependent. On Vercel each is a separate function invocation
costing roughly 0.3 to 1.1s of pure overhead before any query runs, measured
against production. That fan-out, not the database, is the 10 second
transition Jonas reported. Queries themselves are single-digit ms.

`/api/today/bootstrap` (#145) collapses those nine into one, with each section
falling back to its own endpoint if it fails server-side, so a partial failure
degrades instead of blanking the screen. **The other tabs were never audited
for the same shape** — `/activities` alone has 12 `apiFetch` call sites. That
audit is the next piece of work, and any tab with the same fan-out gets the
same treatment.

**Do not chase this in the database layer.** Saving one round trip inside
`withUser` was tried in #144 and closed: `sql.reserve()` returns a deliberately
minimal connection missing both `options` (which Drizzle reads for its type
parsers) and `begin` (which the four routes that nest a transaction inside
`withUser` need for their SAVEPOINT). Making it imitate the full client means
chasing internals to save 50ms, against a 750ms problem, at the risk of quietly
breaking the transaction guarantee that keeps `SET LOCAL app.user_id` from
leaking across pooled requests. Wrong lever, and the closed PR says so in full.

---

## 2.5 Opening sign-up: Google, then email, then Apple

Today two providers mint a session, Strava and Google, and both are gated by an
allowlist holding one account. Auth and data are separate concerns: signing in
does not have to be the thing that brings runs in. The device and app step in
onboarding makes that explicit, so someone can sign in with anything and
connect Strava afterwards.

`user_identities.provider` is a plain text column with a unique pair on
(provider, account id), so **adding a provider is additive and needs no
migration**.

### The hard dependency, before any of this
**Opening sign-up to anyone requires the route leaks closed and row level
security enforced.** Until then, a second person signing in can read and in
some cases delete the owner's data. That is not caution, it is the 37 leaks in
`PHASE3_LEAKS.md`. Order is not negotiable:

1. Leaks closed and RLS enforced (in flight)
2. Per-user OAuth tokens, so one person connecting Strava does not overwrite
   another's (in flight)
3. Then, and only then, remove the allowlist

### Then, in this order
**Google for everyone.** Already built and working. Opening it is deleting the
allowlist check, not writing a provider. Cheapest real signup path once the
prerequisites are met.

**Email magic link.** The universal fallback for anyone with neither a Strava
nor a Google account. Passwordless, so there are no hashes to leak, no reset
flow and no password support burden. **No email provider is installed today**,
so this needs one plus a sending domain with SPF, DKIM and DMARC. Budget the
deliverability setup, not the code.

**Sign in with Apple.** Becomes a store requirement rather than a choice: Apple
requires it if an iOS app offers any other third-party sign-in, and ours would
offer Strava and Google. So it lands with the native app in
`NATIVE_APP_PLAN.md`, not before.

**Keep Strava as the headline option.** For a runner it is the best front door:
one tap gives identity and the data, and they already have the account. It
should stop being the only door, not stop being the first.

**Deliberately not doing passwords.** Storing hashes buys breach liability, a
reset flow and a support surface, in exchange for nothing a magic link does not
do better.

---

## 3. Prerequisites for anything multi-provider

Not nice-to-haves. See `NATIVE_APP_PLAN.md`.

- **`wellness_metrics` is unique on date alone.** A second source colliding
  with Garmin on the same night overwrites it. Needs `(source, date)` plus a
  rule for which source wins.
- **`activities` uses separate `stravaId` and `garminId` columns.** That does
  not extend to a third provider. Needs a provider plus external id pair.
- **Do not blend HRV across sources.** Apple samples SDNN sporadically, Garmin
  measures rMSSD overnight. Different measurements. One baseline per source,
  and the card should name which one it is using.

---

## 4. Known gaps, deliberately left

- **Garmin partial-failure duplicate.** If Garmin's create call succeeds but
  the write of the returned id fails, a duplicate can appear. Narrow window,
  real. Flagged during the watch-eligibility work.
- **`reminder_settings` and `push_subscriptions` assume one athlete.**
  `reminder_settings` is commented as a singleton. Fine today, breaks with a
  second user.
- **Unit preference is client-side.** Workout titles are generated in km and
  stored on the row, so the calendar summary, the Garmin label and the push
  body stay in km even for a miles athlete. Needs the preference server-side.
  Only worth doing if Jonas switches to miles.
- **Session titles now use a middle dot**, but titles are baked onto rows at
  generation time, so older rows keep their em dash. Both forms coexist. No
  migration was written for a punctuation change.
- **Custom workout templates are shipped**, not dormant. An earlier version of
  this document said otherwise and was wrong.

---

## 5b. Shipped 30 July to 1 August, do not redo

**Neon to Supabase, complete.** Schema, then a driver-level data copy in FK
topological order with a schema diff before any write and per-table row counts
after (`web/scripts/supabase-migration/`). Two things that bit and are worth
remembering: the copy must clear the migration-seeded `strength_exercises`
rows first, or `ON CONFLICT DO NOTHING` keeps the target's fresh UUIDs and
orphans every strength set pointing at the source's; and Supabase's `postgres`
role carries `BYPASSRLS`, so the isolation test passed against it while proving
nothing. The app runs as `kadenz_app`, created `NOBYPASSRLS` — never as
`postgres`.

**Today screen fan-out collapsed** to a single bootstrap call (#145).

**Playwright runs in CI**, against a production build rather than `next dev`,
which both removed the flake and cut the job from 5m30s to 2m50s. The flake was
never `kraft-duration-equipment.spec.ts` being a bad assertion, as the old
version of this document assumed — it was `/_error` being unwarmable under
`next dev`.

---

## 5. Shipped 28 to 29 July, do not redo

Wellness from the watch folded into readiness behind a 21 night warm-up.
Cloudflare Worker cron every 5 minutes, after measuring that GitHub Actions was
delivering hour-plus gaps against a 15 minute schedule. Profile soft delete.
Kraft made multi-athlete: Achilles as a complaint rather than three of six
cards, per-session duration and equipment overrides, exercise search with ten
measured muscle groups, Biceps and Triceps split out of an `Arms` catch-all.
App-wide sheet focus management and 44px touch targets. Copy cleaned of em
dashes and marketing phrasing. A Playwright harness that drives the real UI
without OAuth.

Then, all from real use: Strava update and delete webhooks plus a repair path
reachable from the sync button; ad hoc Kraft sessions no longer auto-push to
the watch; movement-family history so equipment variants stop reading as
stale; extra sets beyond the prescription; session start and finish times with
auto-close and a complete-or-discard prompt; completed sessions ordered by
what was actually done; strength activity linking and the heart rate chart.

---

## 6. Process rules learned the hard way

- **Never run `vercel --prod` by hand.** Deploying from the shared checkout put
  ten minutes of stale code on production on 27 July. Production deploys come
  from a push to main. If a manual deploy is genuinely needed, run it from a
  worktree freshly reset to `origin/main` and check `git log --oneline -1`
  first.
- **Never read `~/GitHub/kadenz/web/src` directly.** That checkout sits on a
  stale branch. It produced two confident false bug reports and one wrong
  production seed. Read via `git show origin/main:<path>` or a fresh worktree.
- **Check open PRs, not just main, for the next migration number.** Collisions
  happened five times.
- **No destructive SQL against production.** An agent once deleted rows it had
  not created using a time-window delete. Capture ids with `returning({ id })`
  and delete only those.
- **Ship the control with the capability.** `refresh: true` was added to the
  backfill API with no UI sending it, so the repair path was unreachable and
  the bug looked unfixed. A capability nobody can reach is not shipped.
- **A passing suite is not evidence the feature works.** Both sync bugs, the
  stale history date, the blank heart rate chart and the link that appeared to
  do nothing all passed every test. Browser-level tests catch some of it. Using
  the app catches the rest.
- **Typecheck, lint and unit tests do not prove a database wiring change
  works.** #144 passed all three and every API route on it returned a 500,
  because nothing in those gates drives a real request through the real client.
  Only the browser suite caught it, and it caught a second, different break
  after the first was patched. Any change to `db/index.ts` or `with-user.ts`
  runs `npm run test:e2e` before it is pushed.
- **A green signal over work that is not happening is this project's
  characteristic failure.** `rowsecurity` reading true while the owner bypassed
  it; a tenancy tripwire asserting a column instead of a policy; CI not running
  on stacked PRs while reporting clean; a cron job silently doing nothing in
  production for days. When something passes, check that it could have failed.
- **Worktree disk fills fast**, roughly 800MB each. Remove merged, clean
  worktrees rather than only clearing `node_modules`.
