# Kadenz plan of attack

Written 2026-07-27 after a long build session. 51 commits shipped that day.
This is what is left, why, and what only Jonas can do.

---

## 1. Needs Jonas, nobody else can do these

Priority order: 1.1 is the only security item, do it first. 1.2 and 1.3 each
leave a shipped feature inert until done.

### 1.1 Rotate the Neon database password (STILL OPEN, needs a browser)
`neonctl` credentials on this machine have expired and re-auth needs an
interactive browser OAuth, so this could not be automated. Run
`! npx neonctl auth` yourself, then the steps below.

The production connection string was pasted into a chat session, so the
password `neondb_owner` is considered exposed.

- Neon console, Roles, `neondb_owner`, Reset password
- Copy the new **pooled** connection string (host contains `-pooler`), keep
  `?sslmode=require&channel_binding=require` on the end
- Vercel, project kadenz, Settings, Environment Variables, `DATABASE_URL`.
  It is a sensitive variable so it cannot be edited in place: delete and
  re-create it, or have Claude set it with
  `vercel env add DATABASE_URL production --force --sensitive`
- Redeploy, then confirm `/api/today` returns 200

Note: the app broke earlier that day because the value lost its
`?sslmode=require` suffix. The error was `connection is insecure`. Check the
full value saved, query string included.

### 1.2 Upgrade Neon, or accept cold starts
Measured: 2.5s for one API call after 400s idle, versus 0.9s warm. Pooling is
already correct, so this is Neon's compute autosuspend, fixed at about 5
minutes on the free tier and not adjustable.

A keep-alive ping was investigated and rejected on arithmetic: preventing a
suspend means keeping compute continuously alive, which is roughly 240
compute-hours a month for an 8 hour window against a free budget of about 192.
It would bill or throttle. Upgrading Neon is the honest fix.

### 1.3 Cloudflare Worker cron (DONE, deployed and verified)
GitHub Actions does not honour sub-hourly schedules on this repo. Observed 3
runs against a configured every-15-minutes, with gaps of 67 minutes, 2h46m and
1h50m. GitHub documents `schedule` as best effort.

This means **workout reminders currently fire late or not at all**, and the
sync-drain safety net is equally unreliable. A Cloudflare Worker replaces it.

Deployed as `kadenz-cron`, schedule `*/5 * * * *`, verified registered. The
account had never used Workers, so a `kadenz.workers.dev` subdomain had to be
created first (API error 10063 blocks every cron trigger until one exists).
The Worker itself sets `workers_dev = false` and serves nothing there.

### 1.4 Add Kadenz to the iOS home screen
Web push on iOS only works for an installed PWA (iOS 16.4+). A normal Safari
tab cannot receive notifications. Until this is done, reminders cannot reach
the phone no matter how reliable the scheduler is.

### 1.5 Reconnect Google Calendar
The OAuth grant is dead and has been for some time. Before reconnecting, note
that 403 queued jobs from archived plans were already cancelled, so
reconnecting is now safe and will sync the active plan only.

---

## 2. Status as of 2026-07-27 evening

Merged: #68 this doc, #69 Cloudflare Worker cron, #70 Garmin wellness into
readiness, #71 profile soft delete, #72 doc correction. No open PRs.

**Done already, do not redo:**
- The Garmin worker is **deployed to Fly.io** with the new `/wellness` route.
  Verified live: `/health` returns 200 and `/wellness` returns 422 rather than
  404, so the route exists and is rejecting unauthenticated calls as intended.
- The readiness maths, the `wellness_metrics` table and the daily pull are all
  merged. Once the app has nights of data, the card starts using it.

**The open items are exactly section 1.** Nothing is blocked on Claude.

---

## 3. Product work, ready to build

### 3.1 Readiness from real physiology (SHIPPED #70, deployed)
Readiness previously used only self-report: energy, sleep QUALITY 1-5,
soreness, illness and injury, plus pain logs, RPE and 7-day volume against the
prior 3-week average. It now also uses the watch.

**Source: Garmin, not Intervals.icu.** `intervals-client.ts` turned out to be
a stub where every method throws `NOT_IMPLEMENTED`, and no
`INTERVALS_ICU_*` credentials exist in Vercel or any local env. It was never a
real option, despite looking like one. The Garmin worker was already deployed
and authenticated, so `/wellness` was added there instead, pulling sleep
duration and resting HR from `garth.DailySleepData` and HRV from
`garth.HRVData`.

Shipped: `wellness_metrics` table, a daily pull on the existing cron that
backfills up to 60 nights of watch history, and `web/src/lib/physiology.ts`
holding the baseline maths as pure tested functions.

The design constraints below were the point of the exercise and still govern
any change to it:

- HRV means nothing in absolute terms. It signals only against the athlete's
  own rolling baseline, conventionally 7-day against 30 to 60 day. A single
  night is noise.
- This needs weeks of data before it can say anything. The card must say so
  during the warm-up window rather than showing a confident number.
- Do not replace self-report. Subjective wellness questionnaires are well
  validated and capture what physiology misses. Combine.
- Every physiological adjustment must produce a `reason`, like existing
  signals. "HRV 18 percent below your baseline" beats "Readiness 62".
- Device sleep DURATION and check-in sleep QUALITY are different things. Keep
  both.

As built: a **21-night warm-up floor** (`MIN_BASELINE_NIGHTS`). Below it the
physiological signal contributes exactly zero and the card says "Building your
recovery baseline from the watch (N/21 days)" rather than inventing a verdict.
Above it, a 7-day recent average runs against a 30 to 60 day baseline, and
every adjustment carries a reason. The 60-night backfill means the warm-up may
clear faster than three weeks from a standing start.

### 3.2 Apple Health
HealthKit has no web API and a PWA cannot read it. The realistic bridges are a
native iOS companion app, or an exporter app posting to a webhook. Since the
watch is Garmin, Apple Health is mostly a slower path to the same data. If a
webhook ingestion endpoint gets built for anything else, it makes this cheap
later.

### 3.3 Units on the watch, calendar and notifications
Workout titles are generated in km and stored on the row. In the app they now
reformat live, so a miles athlete sees miles. But the Google Calendar summary,
the Garmin workout label and the push notification body all use the stored km
title, because those run server side and the unit preference lives in
`localStorage`.

Fixing this properly means moving the unit preference server side. Only worth
doing if Jonas actually switches to miles.

---

## 4. Known gaps, deliberately left

- **Custom workout templates are shipped, not dormant.** An earlier version of
  this document claimed they were unused. That was wrong. `useCustomWorkouts`
  renders a Custom section on the Kraft picker with edit, delete and start
  (`web/src/app/strength/page.tsx:196` and `:1003`), backed by
  `CustomWorkoutBuilder`.
- **`DELETE /api/profiles`** now soft deletes behind a name confirmation
  token, and refuses to remove the profile the caller is currently using.
  Resolved, kept here so nobody re-adds a hard delete.
- **Stats plan payload** trimmed from 101KB to 67KB by dropping blocks. The
  remaining pattern (`GET /api/plans` then `GET /api/plans/[id]` independently
  on Today, stats and rearrange) was left alone: no client cache exists and
  they are separate navigations.
- **Dumbbell scaling in the Kraft hub** now matches exercise history. If a
  fourth surface ever needs volume, use `sessionVolume()` in
  `web/src/lib/strength/volume.ts`. Do not write a new sum.

---

## 4b. Kraft, how it really works and what is Jonas-shaped

Established by reading `origin/main`, because the page looks more hardcoded
than it is and that misreading has already caused one wrong claim.

**It is generated, not canned.** The picker shows 6 fixed programme cards from
`TYPE_META` (`web/src/app/strength/page.tsx:107`) plus saved customs. Tapping
one calls `POST /api/strength/sessions`, which runs `buildSessionPlan()`
(`web/src/lib/strength/session.ts:133`) over the 99 exercises defined in
`web/src/lib/strength/program.ts:15` and seeded into `strength_exercises`.

**Onboarding already drives it.** `strength_plan_settings`, written by the
wizard at `/strength/setup`, feeds generation per profile:
- `equipment` resolves which variant fills each slot and drops accessories the
  athlete cannot perform (`session.ts:107-122`)
- `complaints` inject targeted work (`session.ts:81-88`)
- `ability` scales sets and rest
- `bodyweightKg` and `sex` seed cold-start loads
- `durationMinutes` is genuinely enforced by `duration-fit.ts`, which trims or
  grows the list to fit, and a live estimate renders from `estimate.ts`

So exercises, loads and length are already per-user. The session *types* are
not.

**What is actually Jonas-shaped:**
- Three of the six cards are Achilles rehab (`upper_achilles`,
  `lower_achilles`, `achilles`). A user without that injury sees three dead
  cards. Achilles should reshape Upper/Lower/Full Body as a complaint, which
  is what every other complaint already does, not occupy top-level slots.
- `goal` (running focus versus all round) is collected by the wizard and never
  read by generation. Dead input: wire it or drop it.
- No per-session equipment override. `ACCESS_PRESETS` for home, box and full
  gym exist in `equipment.ts:53`, but equipment is a persisted profile setting
  only, so a gym day or travel means editing your profile.
- Duration is a profile setting, not a per-session choice.

**Planned shape:** a 2-column programme grid over a standard set (Full Body,
Upper, Lower, Push, Pull), with duration and today's-equipment visible on the
card before committing, a pre-start sheet showing the generated exercise list
with the live estimate and a session-only equipment override, then the
existing set logger.

---

## 5. How this codebase fails, and how to avoid repeating it

Eight bugs in one day shared one shape: **a concept implemented in several
places, drifting apart**. Pace formatting (3 copies), session volume (4),
missed-versus-skipped day state (3), plan distance, workout titles, weight
unit conversion, past-due logic, and the stepper control (3).

Why it keeps happening: each is simple enough to retype inline, so nothing
forces a call site to reach for a helper. And several sit on data that is
ambiguous by convention only. `strength_sets.weightKg` means "per dumbbell",
enforced by a comment alone, so every new reader re-derives the meaning and
that is where copies diverge. All of them were locally correct, which is why
they passed review.

Prevention, in order of value:

1. Before adding display or derivation logic, grep for the shape being added
   (a `.reduce(` sum, a `formatX`, a `status ===` filter) and check whether a
   helper already exists.
2. Encode ambiguous units in the field name or type, not a comment on one call
   site. Comments do not travel to the next file reading the same column.
3. When consolidating, DELETE the wrong implementation. Leaving it reachable
   is what restarts the cycle.
4. Put the exact production numbers that exposed the bug into the regression
   test.

See `docs/DUPLICATION.md` in the repo.

### Process notes that cost real time
- **Never read `~/GitHub/kadenz/web/src/...` directly.** The shared checkout
  sits on a stale branch. It produced two confident false bug reports and one
  wrong production seed (71 exercises instead of 88). Read via
  `git show origin/main:<path>` or from an up-to-date worktree.
- **Check open PRs, not just main, for the next migration number.** Number
  collisions happened three times in one day.
- **No destructive SQL against production.** An agent deleted 2 rows it had
  not created using a time-window delete during cleanup. Capture ids with
  `returning({ id })` and delete only by that list.
- **Worktree disk fills fast.** Roughly 800MB of `node_modules` each. Remove
  merged, clean worktrees rather than only clearing `node_modules`.

---

## 6. Verify after restart

    gh pr list                    # merge anything green
    git log origin/main --oneline -5

Then check on the phone: Today shows achieved pace for a completed run, the
Kraft session fits one screen, activity detail renders heart rate and pace
charts (these had never worked before that day), and the plan hub counts
actual distance.

---

## 7. Kraft rebuild, waiting on design

Jonas is prompting Claude Design for two screens. Once they exist, the
functional work behind them is known (evidence in section 4b):

1. **Kraft hub.** 2-column programme grid over a standard set (Full Body,
   Upper, Lower, Push, Pull). Duration and today's equipment visible on the
   card before committing, because both already change what gets generated.
   Custom workouts as their own section below.
2. **Pre-start sheet.** Tap a programme, see the actual generated exercise
   list with the live duration estimate, swap or reorder, override equipment
   for this session only, then start. This is where the per-user generation
   becomes visible instead of silent.

Behind them, four changes:
- Collapse the three Achilles cards into complaint-driven variants of the
  standard five. The engine already reshapes sessions by complaint, so this is
  mostly deleting top-level entries and letting the existing path run.
- Wire `goal` into generation or drop it from the wizard. Collecting an input
  and ignoring it is worse than not asking.
- Per-session equipment override ("at the gym today"). `ACCESS_PRESETS` for
  home, box and full gym already exist in `equipment.ts:53`.
- Duration as a per-session choice, not only a profile setting. The fitting
  logic in `duration-fit.ts` already accepts a target, so this is plumbing.

Not yet designed and worth considering later: the set logger during an active
session, which works but has had no design pass.

---

## 8. Incident 2026-07-27: stale checkout deployed to production

**What happened.** Running `vercel --prod` from
`/Users/jonasheller/GitHub/kadenz/web` deployed the SHARED CHECKOUT, which was
sitting on branch `verify23` at an old commit, straight to production. For
roughly ten minutes the alias served code that predated the day's work: the
homepage stayed up, but `/api/cron/*` and everything else added that day
returned 404.

**Why it is worth recording.** This is the exact trap already written down in
the process notes above ("never read `~/GitHub/kadenz/web/src`, the shared
checkout is on a stale branch"). The note said do not READ from it. It did not
say do not DEPLOY from it, and so the same stale-checkout hazard bit twice in
one day through a door nobody had thought to close.

**Fix applied.** Merged a pending PR to main, which triggered Vercel's git
integration to build and promote the real main. Recovery confirmed by polling
`/api/cron/reminders` until it returned 200.

**Rule going forward.** Never run `vercel --prod` by hand. Production deploys
come from a push to main via the git integration, which builds a known commit.
If a manual deploy is ever genuinely needed, run it from a worktree that has
just been reset to `origin/main`, and verify `git log --oneline -1` first.

### CRON_SECRET was rotated the same evening

`vercel env pull` returned a value that the running app rejected with 401,
while GitHub Actions was getting 200 with its own copy. The real value could
not be read from anywhere, so rather than guess, a fresh 48 character secret
was generated and set in all three places that hold it:

- Vercel production env (`CRON_SECRET`)
- GitHub Actions repo secret (`gh secret set CRON_SECRET`)
- Cloudflare Worker secret (`wrangler secret put CRON_SECRET`)

Verified afterwards: direct call returns 200, a dispatched GitHub Actions run
succeeded, and the Worker holds the same value.

**Left deliberately:** the Preview and Development Vercel environments still
hold the OLD `CRON_SECRET`. Production is what every cron caller targets, so
this is harmless, but if a preview deployment is ever pointed at a cron caller
it will 401 until those are updated too.
