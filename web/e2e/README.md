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
   database, on `127.0.0.1:3100`, with `KADENZ_E2E=1` set — see "No compiling
   while tests run" below.
5. Mint a valid session cookie and hand it to every test via Playwright's
   `storageState` — see "Auth" below.
6. Request every page and every route handler once, so nothing compiles for
   the first time while a spec is running (see below).

## No compiling while tests run

This is the single most important property of the harness, and the cause of
most of its early flakiness.

`next dev` compiles a page or route handler the first time it is requested,
and every such compile pushes a Fast Refresh update over the HMR socket to
whatever page is open at that moment. That update is not harmless:

- a page that takes one while it is still hydrating can stop hydrating
  altogether, leaving the app on the boot splash until the test times out on
  an element that never appears, and
- a page that takes one after hydrating drops its in-flight fetches, so a card
  that was loading simply never renders.

Both look exactly like real product bugs, in a spec that had nothing to do
with the route that happened to compile.

Two things together remove it:

- `global-setup.ts` requests every page (GET) and every route handler
  (OPTIONS, which makes Next load the module without running a handler body)
  before the first spec. Dynamic segments are filled with an id that matches
  nothing. The list is read from `src/app`, not hand-maintained, so a spec for
  an existing route is covered without anyone remembering this file.
- `next.config.ts` raises `onDemandEntries` when `KADENZ_E2E=1`. Next dev
  otherwise keeps only 5 compiled routes for 60 seconds each, so with ~110
  routes it would evict and recompile them all run long no matter how
  thoroughly they were warmed. `next build` ignores this setting.

If you add a spec and see intermittent "element never appeared" failures,
check the dev server log for a slow request during the test: a request taking
seconds means something compiled, and something compiled means a hot update
landed on the page under test.

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

Deliberately not wired into `.github/workflows/ci.yml` in this change —
getting a browser test runner green in CI (service containers, caching the
downloaded Postgres/Chromium binaries, etc.) is its own piece of work, and
mixing it with building the harness itself would make both harder to review.

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
