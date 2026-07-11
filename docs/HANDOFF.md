# Kadenz — Strength Module + Benchmark-Parity Handoff

_Last updated: 2026-07-11. Written at the end of a Claude Code **web** session so a
future Claude (in **terminal**) can pick the work up. Read this top to bottom
before touching the strength/activity/plan features._

---

## 1. What Kadenz is

A personal, **single-user** running-plan PWA. Stack:

- **Next.js 16 App Router** (heavily modified — see §2), **TypeScript**, **Tailwind v4**
  (CSS-var tokens: `bg-bg`, `text-text-1/2/3`, `bg-surface`, `bg-elevated`,
  `text-accent`, `text-on-accent`, `text-warn`, `text-danger`, `--radius-card`,
  `--radius-input`).
- **Drizzle ORM** on **Postgres (Neon)**. Schema: `web/src/db/schema.ts`,
  migrations: `web/drizzle/`.
- **motion/react**, **lucide-react**, **@dnd-kit** (plan page DnD).
- Custom UI kit under `web/src/components/ui/`: `Sheet`, `Button`, `Segmented`,
  `Switch`, `NavBar`, `List` (`ListGroup`/`Row`), `feedback` (`Skeleton`,
  `EmptyState`), `PullIndicator`, `TransitionLink`.
- Deployed on **Vercel** (project `kadenz-fhgx`) at **https://kadenz-running.vercel.app**.
  Auto-deploys on push to `main`. API routes are **auth-gated** (return 401 to
  unauthenticated callers — you can't curl them without a session cookie).
- Sync integrations: **Strava** (webhook ingest + activity match), **Google
  Calendar** (`sync_outbox` fan-out + daily cron `/api/cron/gcal`),
  **Intervals.icu** (`lib/sync/intervals-client.ts`), a **garmin-worker** (Python).

Working branch this session: **`claude/kadenz-strength-module-pssfdt`**.

---

## 2. ⚠️ Environment gotchas — read before coding

- **`web/AGENTS.md` says the Next.js is NOT stock.** Breaking changes vs. training
  data. Before writing framework-level code, read the relevant guide in
  `web/node_modules/next/dist/docs/`. Builds MUST use **`next build --webpack`**
  (already the `build` script).
- **Do NOT add `outputFileTracingRoot` to `next.config.ts`.** It previously broke
  Vercel deploys (routes-manifest ENOENT). A whole PR was reverted for this.
- **React 19 / eslint-config-next 16 lint rules are strict:**
  - `react-hooks/set-state-in-effect` — calling `setState` in an effect body
    flags even after an `await`. Fix pattern: `// eslint-disable-next-line
    react-hooks/set-state-in-effect` on the line, or restructure.
  - `react-hooks/refs` + `react-hooks/purity` — **you may not read a mutable
    ref's `.current` or call `Date.now()` during render.** Pattern used in
    `GuidedRun.tsx`: an interval ticker computes derived values and pushes them
    into a `view` state; render reads only state.
  - The repo has **known pre-existing lint errors** in `src/app/page.tsx`
    (lines ~355/368/895/907) — not yours; leave them.
- **CI** (`.github/workflows/ci.yml`) exists on a branch (PR #46, **unmerged**),
  so PRs currently have **no required checks**. That's why merges went straight
  through this session.

### Terminal vs. web environment (important)

The **web** session (Claude app / claude.ai/code) runs in an **isolated cloud
container** cloned fresh from GitHub. It has: the repo, `psql`/`pg_dump`,
GitHub auth (`GITHUB_TOKEN`), and configured MCP connectors — **but NOT**
`DATABASE_URL`, Vercel, or Neon credentials. Your **terminal** Claude Code runs
on the Mac and inherits your authenticated CLIs (`vercel`, Neon, env vars). So:
**infra/DB/deploy tasks → do them in terminal;** big autonomous coding/PR runs
→ web is fine.

---

## 3. Database migration situation (the recurring blocker)

**How prod was created:** via `drizzle-kit push` — so the Neon DB has **no
`__drizzle_migrations` journal**. Consequence:

> **Do NOT run `npm run db:migrate` / `drizzle-kit migrate`.** It would try to
> re-apply the non-idempotent `0000_cloudy_vapor.sql` baseline (raw
> `CREATE TYPE`/`CREATE TABLE`) and fail.

Migration files (`web/drizzle/`):
- `0000_cloudy_vapor.sql` — baseline, **NOT idempotent** (already applied to prod).
- `0001_schema_drift_fixes.sql` — idempotent (`ADD VALUE IF NOT EXISTS`).
- `0002_strength_module.sql` — strength tables + `wellness_logs`; idempotent
  (enums via `DO $$ … EXCEPTION WHEN duplicate_object`).
- `0003_strength_set_duration.sql` — `strength_sets.duration_seconds`; idempotent.
- `0004_activity_strength_link.sql` — `activities.strength_session_id` +
  `activities.sport_type`; idempotent.

**The safe applier: `web/scripts/migrate.mjs`** (added this session). It reads
`DATABASE_URL` from the env, applies `drizzle/0002+*.sql` **statement-by-statement**
with the `postgres` client (splitting on `--> statement-breakpoint`), **skips
`0000`**, and **never throws** (no URL → skip+exit 0; SQL error → log+exit 0).
Proven against a local Postgres seeded with the `0000`+`0001` baseline: run 1
creates everything, runs 2–3 are clean no-ops.

**It now runs automatically on every Vercel build** — `web/package.json` build is
`node scripts/migrate.mjs && next build --webpack`. So on Vercel (where
`DATABASE_URL` is a build env var) migrations apply on each deploy.

### Verify / apply manually (terminal)

```bash
cd web
vercel env pull .env.local          # gets DATABASE_URL from Vercel
set -a; . ./.env.local; set +a       # load into shell
node scripts/migrate.mjs             # apply (idempotent; safe to re-run)
psql "$DATABASE_URL" -c "\d activities" | grep -E 'sport_type|strength_session_id'
psql "$DATABASE_URL" -c "\dt strength_sessions"
```

**OPEN QUESTION at handoff:** whether Vercel exposes `DATABASE_URL` at *build*
time (it should — standard Production var). If the build log shows
`[migrate] DATABASE_URL not set — skipping migrations.`, the migration did NOT
run via the build; apply it manually (above) or add a GitHub Actions runner with
a `DATABASE_URL` secret. If it shows `[migrate] 0002_…: N statement(s) ok`, done.

Until 0002–0004 are confirmed applied, these features **error or return empty**:
strength module, Performance stats, activity linking, ad-hoc strength logging.

---

## 4. What shipped this session (all merged to `main`)

| PR | Title | Key files |
|----|-------|-----------|
| #52 | Unified run + strength activity feed (Strava auto-match + linking backend) | `api/activities/route.ts`, `lib/sync/strava-client.ts`, `api/activities/[id]/route.ts` (PATCH) |
| #53 | Link/unlink UI | `app/activities/page.tsx`, `api/activities/[id]/candidates/route.ts` |
| #54 | **Performance & achievements** | `api/performance/route.ts`, `app/stats/page.tsx` |
| #55 | **Instant / ad-hoc logging** (run + strength) | `api/activities/manual/route.ts`, `app/activities/page.tsx` |
| #56 | **Guided run player** | `components/GuidedRun.tsx`, `app/workout/[id]/page.tsx`, `app/settings/page.tsx`, `lib/settings.ts` |
| #57 | **Adaptive adjustment tray** | `api/plan/adjustments/route.ts`, `components/PlanAdjustmentTray.tsx`, `app/page.tsx` |
| #58 | **Auto-migrate on Vercel build** | `scripts/migrate.mjs`, `package.json` |

### Feature notes for future work

- **Performance** (`/api/performance`): runs = `activities` with distance & no
  `strengthSessionId`. PRs are *projected* (best sustained pace × distance),
  1K from fastest split. Badge ladders in `buildBadges()`. Surfaced in the
  **Stats** tab (loads independently of the plan via `Promise.allSettled`).
- **Guided run** (`components/GuidedRun.tsx`): self-contained audio + wake lock
  (deliberately NOT sharing the strength `GuidedSession`'s audio). Flattens
  workout `blocks` into steps (intervals expanded rep-by-rep). Optional GPS via
  `navigator.geolocation.watchPosition` + haversine (jitter-filtered): live
  pace/distance, split cues, auto-advance of distance/duration targets;
  falls back to manual **Next** when GPS is denied. Settings group "Guided Run"
  (`runAudio`/`runVoice`/`runGps`/`runSplitCues`/`runKeepAwake` in
  `lib/settings.ts`).
- **Adjustment tray** (`/api/plan/adjustments`): no-migration design. `GET`
  finds still-`planned`, past run sessions (last 21d) + remaining runs this week.
  `POST {action:"skip"|"redistribute", workoutIds}`: `skip` → status `missed`;
  `redistribute` → mark missed + spread km across the week's remaining runs
  (capped +50% each). Server re-validates ids belong to the active plan and are
  genuinely missed before mutating. Both fan out gcal `update`.
- **Ad-hoc logging**: `/api/activities/manual` takes `kind:"run"|"strength"`.
  Strength rows get `sport_type="WeightTraining"`, no distance. UI = Run/Strength
  toggle in the Activities "+" sheet.

---

## 5. Known issues / tech debt

- **2 pre-existing failing tests** in
  `web/src/lib/plan-engine/__tests__/plan-generator.test.ts` (out of scope, were
  red before this work):
  1. `high volume plan has more km than low volume plan` — `trainingVolume`
     isn't actually scaling total km (636 == 636).
  2. `race week contains exactly one race workout on preferred long run day` —
     gets 0 race workouts.
- **Test-file type errors:** the same test file constructs `PlanConfig` objects
  missing `raceElevation` and `easyRunMinKm` (added to the type later). `tsc
  --noEmit` reports these — they're test-only, product code is clean.
- **Pre-existing lint errors** in `app/page.tsx` (see §2).
- The **RPE post-workout feedback loop** (the other half of Benchmark's "adaptive")
  was intentionally deferred — it needs a new `workouts` column (migration),
  which couldn't be applied from the web sandbox.

---

## 6. Remaining Benchmark-parity backlog (not yet built)

From the Benchmark deep-dive this session. Community/social is **explicitly out of
scope** (owner isn't shipping a public app). Prioritized:

1. **Readiness & recovery** — `wellness_logs` table + Intervals HRV/RHR/sleep
   already exist; surface a daily readiness score on Today + post-race recovery
   mode. (Check if a wellness check-in UI already exists: `components/WellnessCheckIn.tsx`.)
2. **RPE feedback → adaptive paces** — needs a `workouts.rpe`/feeling column
   (migration) then nudge future paces. Blocked on migrations flowing.
3. **Shoe / gear mileage** — track pairs, accumulate km from activities, retire
   reminders. Small, no external deps, needs a `shoes` table (migration).
4. **Nutrition & hydration checklist** — pre/post-run fueling on the workout screen.
5. **Manage-plan extras** — holidays, B-races, mobility/yoga sessions.

Anything needing a new table/column: write it **idempotent** (`IF NOT EXISTS` /
`DO $$…EXCEPTION`) as `web/drizzle/0005_*.sql` so `scripts/migrate.mjs` (which
applies `0002+`) picks it up automatically on deploy.

---

## 7. Build / test / run

```bash
cd web
npm install
npm run build          # runs scripts/migrate.mjs (skips w/o DATABASE_URL) then next build --webpack
npx tsc --noEmit       # (2 pre-existing test-file errors expected)
npx vitest run         # (2 pre-existing plan-generator failures expected)
npx eslint <files>     # lint specific changed files; repo-wide has pre-existing errors
npm run dev            # local dev (needs DATABASE_URL + OAuth env for full function)
```

Local Postgres for testing migrations exists in the web sandbox image
(`pg_ctlcluster 16 main start`, role via `sudo -u postgres psql`). On a Mac use
your own Postgres or a Neon branch (`neonctl branches create`).

---

## 8. Suggested immediate next steps (terminal)

1. **Confirm the migration** (§3 verify block) — likely already applied by #58's
   build step; this just proves it. Open `/strength` and `/stats` in the app as a
   smoke test.
2. If confirmed, the strength module + all new features are fully live — pick the
   next backlog item (§6); **readiness/recovery** (#1) is the highest-value,
   partially-scaffolded one.
3. When adding schema: new idempotent `drizzle/0005_*.sql`, and the build
   auto-applies it.
