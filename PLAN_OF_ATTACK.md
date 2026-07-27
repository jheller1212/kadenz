# Kadenz plan of attack

Written 2026-07-27 after a long build session. 51 commits shipped that day.
This is what is left, why, and what only Jonas can do.

---

## 1. Needs Jonas, nobody else can do these

### 1.1 Rotate the Neon database password (do this first)
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

### 1.3 Deploy the Cloudflare Worker cron
GitHub Actions does not honour sub-hourly schedules on this repo. Observed 3
runs against a configured every-15-minutes, with gaps of 67 minutes, 2h46m and
1h50m. GitHub documents `schedule` as best effort.

This means **workout reminders currently fire late or not at all**, and the
sync-drain safety net is equally unreliable. A Cloudflare Worker replaces it.

    npx wrangler login
    npx wrangler secret put CRON_SECRET
    npx wrangler deploy

See the Worker's own README for the exact directory and verification steps.

### 1.4 Add Kadenz to the iOS home screen
Web push on iOS only works for an installed PWA (iOS 16.4+). A normal Safari
tab cannot receive notifications. Until this is done, reminders cannot reach
the phone no matter how reliable the scheduler is.

### 1.5 Reconnect Google Calendar
The OAuth grant is dead and has been for some time. Before reconnecting, note
that 403 queued jobs from archived plans were already cancelled, so
reconnecting is now safe and will sync the active plan only.

---

## 2. In flight at the time of writing

- **Objective readiness** (agent `objective-readiness`): pulling sleep,
  resting heart rate and HRV into the readiness score. See section 3.1.
- **Cloudflare Worker cron** (agent `cron-cloudflare`): see 1.3.

Check open PRs with `gh pr list`. Anything green should be merged.

---

## 3. Product work, ready to build

### 3.1 Readiness from real physiology
Today readiness uses: self-reported energy, sleep QUALITY 1-5, soreness,
illness and injury, plus pain logs, RPE and 7-day volume against the prior
3-week average. No physiological input at all.

Two sources exist and are unused:

- `web/src/lib/sync/intervals-client.ts` already types weight, resting HR, HRV
  and sleep from Intervals.icu. Imported nowhere. Check whether Jonas actually
  has an account with data before building on it.
- The Garmin worker authenticates via `garth`, which exposes daily sleep, HRV
  status, resting heart rate, stress and Body Battery. The worker has no
  wellness endpoints today, so this is real work in the Python service.

Design constraints that matter more than the plumbing:

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
