# Plan of attack: Kadenz as a native app, and Apple Health with it

Written 2026-07-28. Companion to `MULTI_USER_PLAN.md`.

The question that started this was "can we get Apple Health working". The
honest answer is that the way to get Apple Health is to stop being only a web
app. This document says what that costs and in what order.

---

## 1. Why the web routes do not work as a product

HealthKit is a native iOS API with no web interface. A PWA cannot read it, and
no amount of work on the Kadenz side changes that.

Three bridges exist. Two of them are personal-use only:

- **A third-party exporter app** posting to a Kadenz webhook. Works tonight,
  costs nothing to build. But it asks every user to find, buy and configure a
  separate app, so it is not something you can ship.
- **An iOS Shortcut** with a personal automation. Free, fiddly, unreliable for
  continuous background delivery. Fine for one person, not a product.
- **A native app.** The only one that works for users who are not you.

Since the third is on the roadmap anyway, Apple Health is not a separate
integration. It is a feature of the app you would already be building. The
Android equivalent is Health Connect, now the standard replacement for Google
Fit.

---

## 2. The app is closer to native-ready than expected

Measured on `origin/main`:

- **Zero page components read the database.** Not one `page.tsx` imports
  `@/db`. Every screen fetches through the **77 API routes**.
- **96 files carry `"use client"`**, against 92 `.tsx` files in `app/` and
  `components/` combined.
- No `generateMetadata` anywhere. Four dynamic route pages. One proxy.

In other words Kadenz is already a client-rendered app talking to its own REST
API, wearing Next.js as a delivery mechanism. That is the shape that ports
well. It removes the objection that would normally sink this: there is no
tangle of server components holding data-fetching that a native shell cannot
run.

---

## 3. The approach

**Capacitor**, wrapping the existing web app and exposing native APIs through
plugins. One codebase stays. React Native or Expo would mean rewriting the UI
for no benefit the plugins do not already provide, and Swift plus Kotlin means
maintaining three front ends.

What the shell buys, beyond Health:

- **Real push through APNs and FCM.** This removes the current iOS constraint
  entirely: today reminders only work if the user installs the PWA to their
  home screen, because iOS refuses web push in a normal Safari tab. Native push
  makes that whole class of "it silently does not work" disappear. The existing
  `web-push` VAPID path can stay for desktop browsers.
- **Real background sync**, rather than the service worker approximation.
- **App Store and Play Store distribution.**

---

## 4. Dependencies, in the order they bite

### 4.1 Multi-user is no longer optional
Apple will not approve an app whose login is an OAuth allowlist holding one
Strava id. Phases 1 to 3 of `MULTI_USER_PLAN.md` become a hard prerequisite
rather than a product choice, and phase 6 (signup, account deletion, privacy
policy) becomes mandatory too, because the stores require an in-app account
deletion path.

**This is the long pole. Everything else here is smaller.**

### 4.2 Decide what the shell loads
Capacitor ships a web bundle and runs it locally. Next.js server rendering does
not run inside it. Two options:

- **Static export the front end** and point it at the hosted API. Viable
  precisely because no page reads the database today. The four dynamic routes
  and the proxy need checking, and the proxy's auth gating has to move into the
  API layer if it is not already there.
- **Load the hosted app in the shell** and use plugins for native capability.
  Less work, but Apple rejects apps that are only a wrapped website. Health
  integration and native push are genuine native value, so this can pass, but
  it is a weaker position at review.

Prefer the static export. Confirm the proxy's role first.

### 4.3 Health data, once the shell exists
- iOS: HealthKit for sleep, HRV, resting heart rate, workouts.
- Android: Health Connect for the same.
- Both write into the existing `wellness_metrics.source` column, which was
  already built provider-agnostic.

**Blocking schema fix:** `wellness_metrics` is unique on **date alone**
(`wellness_metrics_date_uq`). A second source colliding with Garmin on the same
night would overwrite it. This needs `(source, date)` plus a rule for which
source wins.

**Do not blend HRV across sources.** Apple's HRV is SDNN sampled sporadically,
mostly during Breathe sessions. Garmin's is rMSSD-based and measured
continuously overnight. They are different measurements of different things.
Averaging them produces a readiness score that swings on which device happened
to sample, which is exactly the false confidence the 21 night warm-up exists to
prevent. Each source needs its own baseline, and the card should name the
source it is using.

**Second schema fix:** `activities` carries `stravaId` and `garminId` as
separate unique columns. Health-sourced workouts need a third, and the next
provider a fourth. This should become a provider plus external id pair before
any new source lands.

### 4.4 Store requirements
- HealthKit purpose strings, a privacy policy, and Apple reviewing health data
  usage specifically. Health data may never be used for advertising.
- In-app account deletion on both stores.
- Apple Developer Program and Google Play Console fees.
- Review latency becomes part of every release, which changes how you ship. No
  more merging a PR and having it live in four minutes.

---

## 5. What this means for other trackers

Nothing. **Strava already aggregates them.** Coros, Suunto, Polar, Wahoo and
Apple Watch all push completed activities to Strava, which Kadenz already
imports. A direct integration only buys two things Strava does not carry:
overnight wellness, and structured workout push to the device.

Native Health covers Apple Watch and anything writing into Health or Health
Connect. That leaves Coros and Suunto worth doing only if their users
specifically want structured workouts pushed to the watch, which is a much
narrower reason than "support more devices".

Worth recording: the Garmin integration runs on `garth`, an unofficial client.
It works, but it is not a supported API and can break without notice. That is
an argument for Health being a genuine second pillar rather than a third
convenience.

---

## 6. Recommended order

1. Stabilise what exists. The sync bugs found this week came from real use, not
   from tests, and more integrations multiply that surface.
2. `MULTI_USER_PLAN.md` phases 1 to 3. Required by the stores anyway.
3. Confirm the static export path and what the proxy does.
4. Capacitor shell with native push. Ship that alone if you like: it fixes the
   iOS reminder problem on its own and is worth the release.
5. HealthKit and Health Connect together, after the two schema fixes.
6. Store submission, with the account deletion and privacy work phase 6
   already covers.

Steps 4 and 5 are the fun part and they are last for a reason. Everything above
them is what makes them legal to ship.
