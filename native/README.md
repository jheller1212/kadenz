# Kadenz Native Shell

Capacitor wrapper around the Kadenz web front end, for iOS and Android.

The point of it is native push. Today reminders only arrive if the app has been
added to the iOS home screen, because Safari refuses web push in a normal tab,
and there is nothing in the UI that can tell you that happened. Inside the
shell, notification permission belongs to the app, so that failure mode is
gone. `web-push` with VAPID stays exactly as it is for desktop browsers.

Health data (HealthKit, Health Connect) is deliberately **not** here. That work
comes after multi-user, per `../NATIVE_APP_PLAN.md`.

## How it fits together

```
web/          Next.js app. Serves the API on Vercel, and exports a static
              copy of the UI for the shell (`npm run build:shell`).
native/       This project. Bundles web/out, adds native plugins.
garmin-worker/  Unrelated to the shell.
```

The shell does **not** contain a second copy of any screen. It bundles
`web/out`, which is the same UI the website serves. A screen only ever exists
once, in `web/src`.

The shell runs the UI from local files inside the WebView and calls the hosted
API over the network. Those are two different origins, which is the single most
important thing to understand about this setup and the source of most of the
configuration below.

## Requirements

| Tool | For |
|---|---|
| Node 20+ | everything |
| Xcode 15+ with an iOS simulator | iOS |
| CocoaPods (`brew install cocoapods`) | iOS |
| Android Studio with SDK 34+ | Android |
| JDK 17 | Android |

## First-time setup

```bash
cd native
npm install
npm run build:web        # static export -> ../web/out
npx cap add ios
npx cap add android
npx cap sync
```

`ios/` and `android/` are gitignored. They are generated from
`capacitor.config.ts`, and keeping them out of the repo means a signing
certificate or keystore dropped into them can never be committed.

## Everyday build and run

```bash
npm run build            # rebuild the web export and copy it into both platforms
npm run open:ios         # opens Xcode
npm run open:android     # opens Android Studio
```

or straight to a device or simulator:

```bash
npm run run:ios
npm run run:android
```

`npx cap doctor` reports what is missing if a platform will not open.

Any change to `web/src` needs `npm run build` here before it shows up. The
shell has a snapshot of the UI, not a live connection to the dev server.

## What Jonas has to supply

None of this is in the repo, and none of it should be.

### 1. Firebase project

Both platforms send push through Firebase Cloud Messaging. Firebase forwards to
APNs for iOS, so the server has one send path and the APNs key lives in the
Firebase console rather than in Vercel's environment.

1. Create a Firebase project at <https://console.firebase.google.com>.
2. Add an **iOS app** with bundle id `com.kadenz.app`. Download
   `GoogleService-Info.plist` and drop it into `ios/App/App/` (add it to the
   Xcode target when prompted).
3. Add an **Android app** with the same package name. Download
   `google-services.json` into `android/app/`.

Both files are gitignored.

No Gradle editing is needed for Android. The Capacitor template already carries
the `com.google.gms:google-services` classpath and applies the plugin only when
`android/app/google-services.json` exists, logging "Push Notifications won't
work" when it does not. Dropping the file in is the whole step.

### 2. Apple Developer Program, 99 USD a year

Needed for push at all: there is no way to test APNs on a simulator or with a
free personal team.

1. In the Apple Developer portal, create an **APNs Auth Key** (Keys, then
   enable Apple Push Notifications service). You get a `.p8` file, once.
2. Upload that `.p8` to Firebase, under Project Settings, Cloud Messaging,
   iOS app configuration. Also enter the Key ID and your Team ID.
3. **Do not put the `.p8` anywhere in this repo.** It is gitignored here as a
   backstop, but it belongs in a password manager.
4. In Xcode, on the App target, add the **Push Notifications** capability and
   **Background Modes** with *Remote notifications* ticked.

### 3. Google Play Console, 25 USD once

Only needed to distribute. Android push works in development without it.

### 4. Server environment variables

On the Vercel project:

| Variable | Value | Why |
|---|---|---|
| `FCM_PROJECT_ID` | Firebase project id | identifies the project to send from |
| `FCM_CLIENT_EMAIL` | service account email | from the service account JSON |
| `FCM_PRIVATE_KEY` | service account private key | newlines written as literal `\n` |
| `SHELL_ORIGINS` | `capacitor://localhost,http://localhost` | lets the shell's origin call the API |

The service account comes from Firebase, Project Settings, Service Accounts,
Generate new private key. That JSON is a real credential. It goes into Vercel's
environment, never into the repo.

Existing `VAPID_*` variables stay. They are what desktop browsers use.

### 5. Shell build environment variable

When building the static export for the shell:

```bash
NEXT_PUBLIC_API_BASE_URL=https://kadenz-tau.vercel.app npm run build
```

Without it the export uses relative URLs, which inside the shell resolve to the
local bundle. The local bundle has no API routes in it, so every request would
fail. This is a URL and carries no secret, which is why the `NEXT_PUBLIC_`
prefix is correct here.

## The cross-origin session, read this before wondering why login fails

The shell's WebView origin is `capacitor://localhost` on iOS and
`http://localhost` on Android. The API is on `https://kadenz-tau.vercel.app`.
Those are different sites, and that has two consequences.

**CORS.** Handled. `web/src/proxy.ts` answers preflights and echoes back any
origin listed in `SHELL_ORIGINS`, with credentials allowed. The preflight is
answered *before* the session check, because a preflight carries no cookies by
design and would otherwise be rejected before the real request was ever sent.

**The session cookie.** Not handled, and it is the one thing still standing
between this shell and a working login. The cookie is minted
`HttpOnly; Secure; SameSite=Lax` in `web/src/lib/session.ts`. `SameSite=Lax`
means browsers do not attach it to cross-site requests, so the shell's calls
arrive with no session and get a 401.

Fixing it means either `SameSite=None; Secure` on the cookie, or a bearer-token
path for native clients. That is a change to how the whole app authenticates,
and `web/src/lib/session.ts` is being rewritten right now by the multi-user
work (PR #101 gives the session a real user id). Making that change here, in
parallel, would mean two people editing the same auth logic with different
assumptions. It belongs in the session rewrite, done once, by whoever owns it.

Until then: the shell builds, installs, launches and renders. Authenticated API
calls return 401.

## Native push, end to end

1. The settings screen calls `subscribeToPush()`
   (`web/src/lib/reminders/subscribe-client.ts`), which detects the shell and
   routes to `registerNativePush()` in `web/src/lib/native/push.ts`.
2. That asks the OS for permission, calls `register()`, and reads the FCM
   token.
3. It POSTs `{ transport: "fcm", token }` to `/api/push/subscribe`, which
   stores a row with `transport = 'fcm'` and no encryption key pair.
4. The reminder cron reads every subscription and calls `sendToSubscription()`
   (`web/src/lib/reminders/push.ts`), which picks web push or FCM from the
   stored transport. Nothing above that function knows which is which.

`web/src/lib/native/bridge.ts` reaches the Capacitor plugins through the
`window.Capacitor` global rather than importing `@capacitor/core`. That keeps
`web/package.json` free of Capacitor entirely, so the bundle a desktop browser
downloads is byte-identical to the one the shell runs.

### Testing a push without waiting for a real reminder

With the app installed and reminders switched on, find the token in the
`push_subscriptions` table (`transport = 'fcm'`) and send to it from the
Firebase console under Cloud Messaging. A device must be a physical device for
iOS; the simulator cannot receive APNs.

## What has actually been run

Being precise about this, because "it builds" is a claim that should mean
something.

Run, on this machine, and working:

- `npm install` in `native/`, and `npx cap doctor`.
- `npx cap add android`. The project generates and all five plugins register
  against it (`@capacitor-firebase/messaging`, `app`, `push-notifications`,
  `splash-screen`, `status-bar`).
- `npx cap sync`, copying the web export into the Android project.
- The static export in `web/` that produces `web/out`.

Not run, because the tooling is not on this machine:

- **`npx cap add ios` fails**: CocoaPods is not installed, and the active
  developer directory is the Command Line Tools rather than a full Xcode. The
  iOS project has never been generated, let alone compiled.
- **No Gradle build.** There is no Android SDK here, so the generated project
  has not been compiled either. The scaffolding is correct; whether it
  assembles is unverified.
- **No push has been delivered to a device.** There is no Apple Developer
  account, no APNs key and no Firebase project. The send path, the token
  registration and the schema are written and type-checked, and the transport
  routing is unit-tested, but nothing has been end-to-end tested against real
  APNs or FCM.

Treat the iOS side as designed and written, not proven.

## Capacitor version

Pinned to Capacitor 7. Capacitor 8 is out, but
`@capacitor-firebase/messaging` currently targets 7, and having the push plugin
match the core version matters more here than being on the newest major.

## Known limits

- iOS push requires a physical device and a paid Apple Developer account.
- The web export is a snapshot. Rebuild after any `web/src` change.
- App Store and Play Store submission is out of scope here. It needs the
  account deletion path and privacy policy from phase 6 of
  `../MULTI_USER_PLAN.md`.
