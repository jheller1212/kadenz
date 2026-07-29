# Kadenz plan of attack

**Start here.** This is the index. Everything open lives below, or behind one
of the links. Last updated 2026-07-29.

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

- **Rotate the Neon database password.** The connection string was pasted into
  a chat, so treat it as public. Neon console, Roles, `neondb_owner`, Reset.
  Then replace `DATABASE_URL` in Vercel: it is sensitive, so delete and
  re-create rather than edit. Keep the `-pooler` host and the
  `?sslmode=require&channel_binding=require` suffix. Losing that suffix broke
  the app once already, with "connection is insecure". `neonctl` credentials on
  this machine have expired, so this needs a browser.
- **Decide on the Neon plan.** The free tier autosuspends after about 5
  minutes, which is the measured 2.5s cold start, and it is not adjustable. A
  keep-alive was investigated and rejected on arithmetic: preventing suspension
  means keeping compute continuously alive, roughly 240 compute-hours a month
  for an 8 hour window against a free budget of about 192.
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

### 2.3 Wire Playwright into CI
The harness exists in `web/e2e/` and was deliberately left out of the CI
workflow so browser-runner setup could be its own change. Until it runs
automatically it only catches what someone remembers to run.

### 2.4 Fix the flaky e2e spec
`kraft-duration-equipment.spec.ts` has an estimate-threshold assertion that
fails intermittently on clean main, verified independently of any change. A
flaky test in a day-old suite gets ignored fast, and then the suite dies.

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
- **Worktree disk fills fast**, roughly 800MB each. Remove merged, clean
  worktrees rather than only clearing `node_modules`.
