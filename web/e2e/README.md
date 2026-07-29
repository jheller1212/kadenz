# End-to-end tests (Playwright)

Real browser, real app, real (but throwaway) database. This is the first
browser-level test in this repo — everything else in `web/` is unit tests
that can't catch a UI regression that only shows up when a human clicks
through the app.

**This suite never touches production.** It starts its own disposable local
Postgres and its own local dev server, on fixed local ports, and refuses to
run at all if `NODE_ENV=production` or if `DATABASE_URL` is already set to
anything other than its own local database. See "Safety" below.

## Running it

```bash
npm run test:e2e
```

That's it — no separate "start Postgres" step, no Docker required. On first
run, `npm run test:e2e` will:

1. Download and initialise a real local Postgres via the `embedded-postgres`
   package (a genuine Postgres binary, not an emulator, run as a plain child
   process — this happens once; the data directory at `e2e/.pgdata/` is
   reused on every later run).
2. Push the current schema (`src/db/schema.ts`) onto it with
   `drizzle-kit push` — same "dashboard/schema-file is the source of truth"
   convention the real app uses, just pointed at a throwaway database instead
   of replaying the hand-authored migration chain.
3. Seed it with one owner's worth of realistic data (`e2e/seed.ts`): a 6-week
   running plan with weeks and workouts, a few completed activities, three
   strength sessions with logged sets, today's wellness check-in, and 5 days
   of `wellness_metrics` (deliberately fewer than the 21-night baseline the
   readiness card needs — see `readiness-warmup.spec.ts`).
4. Start the app's own dev server (`next dev --webpack`) against that
   database, on `127.0.0.1:3100`.
5. Mint a valid session cookie and hand it to every test via Playwright's
   `storageState` — see "Auth" below.
6. Warm up every route the specs hit, so Next's on-demand dev compilation
   doesn't happen mid-test (see the comment in `global-setup.ts` for why that
   matters — a page reloading mid-interaction the first time it's compiled
   looks exactly like a real bug otherwise).

Re-running `npm run test:e2e` reuses the same local Postgres data directory —
the seed is idempotent (it checks for an existing active plan and no-ops if
one is already there), so re-runs are fast and don't accumulate duplicate
data.

To wipe the local database and start over:

```bash
rm -rf e2e/.pgdata e2e/.auth
npm run test:e2e
```

To reseed by hand against an already-running local Postgres (rarely needed —
mostly useful while iterating on `e2e/seed.ts` itself):

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/kadenz_e2e npm run test:e2e:seed
```

## What's covered

- **`kraft-picker.spec.ts`** — the Kraft picker offers exactly three
  programme cards (Full Body/Upper/Lower), no dedicated Achilles card, for a
  complaint-free athlete.
- **`kraft-duration-equipment.spec.ts`** — a duration chip changes the
  generated exercise list and moves the visible estimate toward the chosen
  budget; an equipment preset changes the generated exercises.
- **`exercise-picker.spec.ts`** — the custom workout builder's exercise
  picker: search filters the list, the Biceps chip returns curl exercises
  (regression guard for the "Arms" catch-all split), clearing search/filter
  restores the full list, a nonsense query shows the empty state.
- **`readiness-warmup.spec.ts`** — the readiness card shows the "still
  building your baseline" warm-up message instead of pretending a 5-night
  physiology history is a confident signal.
- **`bottom-nav-smoke.spec.ts`** — a smoke pass over all five bottom-nav
  tabs: each must render without an uncaught page error and without a
  spinner still spinning after the page settles.
- **`sheet-scroll.spec.ts`** — a real touch swipe on the exercise picker's
  result list scrolls the list instead of getting captured by the sheet's
  own drag-to-dismiss gesture recognizer.

## Auth: there is no bypass

Login normally requires completing Strava or Google OAuth against an
allowlist (`src/lib/owner.ts`, `src/lib/session.ts`) — something no
automated test can click through. This suite does **not** add a new way
around that. `e2e/mint-cookie.ts` calls `makeSessionCookie()` — the exact
same function `src/app/api/auth/{strava,google}/callback/route.ts` already
calls once OAuth succeeds — using a `SESSION_SECRET` that only ever exists in
this local e2e process (`e2e/env.ts`'s `E2E_SESSION_SECRET`, obviously not a
real secret). The resulting cookie is handed to every test via Playwright's
`storageState`. `src/lib/session.ts`'s `validateSessionCookie` is completely
unmodified — the harness proves a valid session, it doesn't weaken what
counts as one.

Zero application code was changed to make this possible.

## Safety

- `global-setup.ts` refuses to run if `NODE_ENV=production`.
- `global-setup.ts` refuses to run if `DATABASE_URL` is already set in the
  environment to anything other than this harness's own local database URL
  (`e2e/env.ts`'s `E2E_DATABASE_URL`, hardcoded to `127.0.0.1`).
- `e2e/seed.ts` independently refuses to run against any `DATABASE_URL` whose
  hostname isn't `localhost`/`127.0.0.1`/`::1` — even if it's ever invoked by
  hand outside the Playwright harness.
- The local Postgres only ever listens on `127.0.0.1`, on a fixed local port
  (`54329` by default), started as a plain child process — no network
  exposure, no shared infrastructure.

## Why Chromium only, mobile viewport by default

Kadenz is a phone-first PWA — the owner has never once loaded it in a
desktop browser. `playwright.config.ts` runs a single `mobile-chrome`
project at 390×844. `hasTouch` is deliberately **not** set globally: with it
on, ordinary `.click()` retries (while a spring animation is still settling)
register as tiny drags, which the app's own PWA pull-to-refresh gesture
picks up as a real page reload mid-test. The one spec that needs a real
touch gesture (`sheet-scroll.spec.ts`) scopes `hasTouch: true` to just that
file via `test.use()`, and drives the gesture through a real CDP
`Input.dispatchTouchEvent` sequence rather than DOM-level `TouchEvent`
dispatch (which doesn't drive native scrolling and so can't tell a real
conflict from a fake pass).

## CI

Runs on every push and pull request as the `Web e2e (Playwright)` job in
`.github/workflows/ci.yml`, in parallel with the lint/typecheck/unit/build
job. It runs `npm run test:e2e` — the exact command you run locally — so
there is no CI-only setup path that can drift from the one you test against.

Notes on that job:

- **No Postgres service container.** The harness starts its own local
  Postgres and refuses to talk to any other database, so a service container
  would just be a second database nothing connects to.
- **Chromium only**, cached by Playwright version.
- **No retries**, in CI or locally. A spec that passes on the second attempt
  is a bug report, not a pass.
- On failure the HTML report and the `test-results` traces are uploaded as
  the `playwright-report` artifact. `npx playwright show-trace` on the
  downloaded zip replays the failing test frame by frame, so a CI-only
  failure does not need a local repro.

## Adding a new spec

- Select on `data-testid`, never on visible copy — a copy pass across the
  app is a routine, ongoing thing here, and a text selector breaks the first
  time a string changes for reasons that have nothing to do with your test.
  If the element you need doesn't have one yet, add it in the same PR (see
  the `data-testid` attributes already threaded through
  `src/app/strength/page.tsx`, `src/components/strength/ExercisePicker.tsx`,
  `src/components/strength/CustomWorkoutBuilder.tsx`,
  `src/components/ReadinessCard.tsx` and `src/components/BottomNav.tsx` for
  the existing pattern).
- Specs run sequentially against one shared seeded database and one shared
  dev server (`fullyParallel: false`, `workers: 1` in `playwright.config.ts`)
  — don't assume test isolation the way you would with a fresh DB per test.
  If a spec creates data it doesn't clean up, later specs will see it.
