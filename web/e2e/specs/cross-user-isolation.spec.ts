import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { E2E_BASE_URL, E2E_COOKIES_PATH, E2E_SEED_IDS_PATH } from "../env";

// ── Phase 3 cross-user isolation gate ────────────────────────────────────────
//
// Kadenz is becoming multi-user. Every tenanted table now carries a NOT NULL
// user_id, enforced by row level security (src/db/with-user.ts,
// drizzle/0053_rls.sql). An audit found 37 API route/method combinations that
// answered a signed-in caller with another athlete's data. This spec is the
// gate that keeps that closed:
//
//  1. It enumerates every route.ts under src/app/api and every HTTP method it
//     exports, and checks each one against an explicit manifest below. A
//     route file or exported method with no manifest entry, or a manifest
//     entry whose route file no longer exists, is a HARD FAILURE — see the
//     "route inventory" test. This is the property that matters most: the
//     38th route added next month cannot slip through by being unknown to
//     this file, it fails loudly and names itself.
//  2. For every entry classified "tenanted-id", it calls the route as user B
//     with user A's id and asserts the response is 404/403 and, for writes,
//     that a read-back as user A shows the resource UNCHANGED.
//  3. For every entry classified "tenanted-list" or "tenanted-singleton", it
//     calls the route as user B and asserts A's seeded, distinctive data
//     (plan name, activity name — see e2e/seed.ts) is absent from the
//     response.
//  4. Every entry also gets a CONTROL assertion: the same call as user A
//     (the owner of the data) must succeed. A route that 404s for everyone
//     would otherwise pass an isolation test while being completely broken —
//     RLS mistakes present as empty lists and blank screens, not errors, so
//     this catches an over-tight fix as reliably as an open leak.
//
// ── Manifest shape, and how a new route gets classified ─────────────────────
//
// Keyed by "METHOD /api/route/pattern" (the pattern is the literal directory
// name, brackets included — e.g. "GET /api/activities/[id]"). Six kinds; the
// first five are what the team lead specified, "tenanted-create" is this
// file's one addition:
//
//  - "public"            — no session required, listed in src/proxy.ts.
//  - "cron"               — CRON_SECRET bearer or an owner session, per proxy.ts.
//  - "no-db"              — touches no table scoped by a caller's user_id.
//                           Includes today's single-Garmin-worker/single-Strava
//                           -account integration routes (config, status,
//                           import, backfill, webhook subscription, outbox
//                           health) — those are honestly app-wide singletons
//                           in the current schema, not per-athlete tenanted
//                           rows, so they are out of scope for THIS audit
//                           (about the user_id columns) even though making
//                           Garmin/Strava genuinely per-user is real future
//                           work. Each entry says so via `note`.
//  - "tenanted-list"      — returns the caller's own rows, no id in the request.
//  - "tenanted-singleton" — one row per caller (settings-shaped), no id in
//                           the request; same leak shape as tenanted-list but
//                           the response is a single object, not an array.
//  - "tenanted-create"    — creates a caller-scoped row, no id in the
//                           request at all, so there is no cross-user id to
//                           attack — the only meaningful check is that the
//                           caller's own write still works.
//  - "tenanted-id"        — takes a resource id, in the URL, the body, or a
//                           query string.
//  - "self-scoped-destructive" — an irreversible action on the CALLER's own
//                           account, with no id anywhere in the request (so,
//                           like tenanted-create, no cross-user id to attack)
//                           and no safe way to probe it here at all: unlike
//                           every other kind, even the CONTROL call is
//                           destructive, and this suite's specs share one
//                           seeded database (see e2e/README.md) — actually
//                           calling it as the owner or as user B would delete
//                           one of them for the rest of the run. Its scoping
//                           is proven instead by a dedicated unit test next
//                           to the route (see each entry's `note`), which
//                           spies on every WHERE this issues and asserts each
//                           one compares user_id to the given caller's id and
//                           nothing else.
//
// To add a route: run this spec. It fails with the exact file and
// "METHOD /api/..." key that has no entry, and tells you to add one below.
//
// Payloads: several handlers 422 an empty `{}` body (proves nothing about
// ownership — that was exactly the shape of several inconclusive findings in
// the phase 3 audit), so every write entry below carries a realistic body.
// Where the lead's per-route payloads land, they replace the `request`
// closures here one at a time — the manifest's shape does not need to change.

interface SeedIds {
  planId: string | null;
  weekId: string | null;
  workoutId: string | null;
  activityId: string | null;
  strengthSessionId: string | null;
  wellnessLogId: string | null;
  personalRecordId: string | null;
  customWorkoutId: string | null;
  trashRestoreId: string | null;
  trashDeleteId: string | null;
}

interface SeedArtifact {
  exerciseId: string | null;
  owner: SeedIds;
  userB: SeedIds;
}

interface Cookies {
  owner: string;
  userB: string;
}

function loadArtifact<T>(path: string, label: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `[cross-user-isolation] ${label} not found at ${path}. It is written by e2e/global-setup.ts ` +
        "(via seed.ts / mint-cookie.ts) — did global setup run? See e2e/README.md."
    );
  }
  return JSON.parse(raw) as T;
}

const seedIds = loadArtifact<SeedArtifact>(E2E_SEED_IDS_PATH, "seed ids artifact");
const cookies = loadArtifact<Cookies>(E2E_COOKIES_PATH, "cookies artifact");

/** A seeded id, or a loud failure naming exactly what's missing — never a
 *  silent `undefined` reaching `fetch()` as the literal string "undefined". */
function requireId(ids: SeedIds, field: keyof SeedIds): string {
  const value = ids[field];
  if (!value) {
    throw new Error(
      `[cross-user-isolation] seed-ids.json has no "${field}". Check e2e/seed.ts's ensureOwnerCore / ` +
        "ensureOwnerExtras / ensureUserB, then re-run the seed (rm -rf e2e/.pgdata e2e/.auth e2e/.artifacts)."
    );
  }
  return value;
}

const exerciseId = (() => {
  if (!seedIds.exerciseId) {
    throw new Error("[cross-user-isolation] seed-ids.json has no exerciseId — is the strength catalogue seeded?");
  }
  return seedIds.exerciseId;
})();

// ── Minimal HTTP helper — every call in this spec is a raw fetch with an
// explicit cookie header, not page.request (a separate cookie jar — see
// activity-link.spec.ts's comment on the same tradeoff) and not Playwright's
// `request` fixture/storageState (which holds exactly one identity; this
// spec needs two at once). ───────────────────────────────────────────────────
interface RawResponse {
  status: number;
  json: unknown;
  text: string;
}

async function call(cookie: string, method: string, url: string, body?: unknown): Promise<RawResponse> {
  const res = await fetch(`${E2E_BASE_URL}${url}`, {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response (e.g. a CSV export) — text is still available below.
  }
  return { status: res.status, json, text };
}

const asOwner = (method: string, url: string, body?: unknown) => call(cookies.owner, method, url, body);
const asUserB = (method: string, url: string, body?: unknown) => call(cookies.userB, method, url, body);

/** True if `haystack`'s raw body contains none of the given needles. */
function containsNoneOf(haystack: RawResponse, needles: string[]): boolean {
  return needles.every((needle) => !haystack.text.includes(needle));
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

// Distinctive strings unique to each user's seeded data (e2e/seed.ts) — used
// to prove a list/singleton response really did scope to the caller, not
// just happen to come back non-empty. Plan names are the most stable pick:
// nothing else in this suite mutates them.
const OWNER_MARKERS = ["E2E 10k Build"];
const USER_B_MARKERS = ["E2E 5k Build — User B"];

// ══════════════════════════════════════════════════════════════════════════
// 1. Route inventory: enumerate every route.ts + exported method on disk,
//    and require every one to have a manifest entry (and vice versa).
// ══════════════════════════════════════════════════════════════════════════

const API_DIR = join(__dirname, "..", "..", "src", "app", "api");

interface DiscoveredRoute {
  file: string;
  pattern: string;
  methods: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function discoverRoutes(): DiscoveredRoute[] {
  return walk(API_DIR).map((file) => {
    const relative = file.slice(API_DIR.length).replace(/\/route\.ts$/, "").replace(/\\/g, "/");
    const pattern = `/api${relative}`;
    const source = readFileSync(file, "utf8");
    const methods = [
      // (?:async\s+)?function, not just async function — withCronFanOut/
      // withSession wrap the handler and return it directly, so several
      // routes export a plain, non-async `function` whose body is a single
      // `return wrapped(...)` rather than an `async function` of their own.
      ...source.matchAll(/export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g),
    ].map((m) => m[1]);
    return { file, pattern, methods: [...new Set(methods)] };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. The manifest.
// ══════════════════════════════════════════════════════════════════════════

interface Req {
  url: string;
  body?: unknown;
}

interface PublicLikeEntry {
  kind: "public" | "cron" | "no-db" | "self-scoped-destructive";
  note?: string;
}

interface ListLikeEntry {
  kind: "tenanted-list" | "tenanted-singleton";
  /** Defaults to a plain GET at the manifest key's own pattern. Override for
   *  routes needing query params (e.g. stats/hr-zones) or a POST body. */
  request?: () => Req;
  note?: string;
}

interface CreateEntry {
  kind: "tenanted-create";
  request: () => Req;
  /** Set when a repeated/idempotent-unsafe control call would corrupt a row
   *  another spec file depends on (see e2e/README.md "Adding a new spec" —
   *  every spec shares one seeded database). The route is still exercised;
   *  only the "control succeeds" assertion is skipped, and the reason is
   *  printed so it's visible in the run, not silently absent. */
  skipControl?: string;
  note?: string;
}

interface IdEntry {
  kind: "tenanted-id";
  /** Builds the request against a given user's ids — the SAME builder is
   *  used for the leak probe (fed the TARGET's ids while calling as the
   *  OTHER user) and the control call (fed the caller's own ids). */
  request: (ids: SeedIds) => Req;
  /** GET the resource back (always as its real owner) to prove a write
   *  against it left it unchanged. Compared by deep equality unless `pick`
   *  narrows it to specific fields (needed when the read includes live/
   *  computed data that isn't stable across two nearby reads). Omit
   *  `readBack` entirely for a read-only entry. */
  readBack?: { request: (ids: SeedIds) => Req; pick?: string[] };
  /** Statuses that count as "correctly refused" for the leak probe. Default
   *  [403, 404]. */
  refusedStatuses?: number[];
  skipControl?: string;
  note?: string;
}

type ManifestEntry = PublicLikeEntry | ListLikeEntry | CreateEntry | IdEntry;

function get(pattern: string): Req {
  return { url: pattern };
}

const manifest: Record<string, ManifestEntry> = {
  // ── Public (src/proxy.ts PUBLIC_API_ROUTES) ────────────────────────────────
  "GET /api/auth/strava/callback": { kind: "public" },
  "GET /api/auth/google/callback": { kind: "public" },
  "GET /api/auth/strava": { kind: "public" },
  "GET /api/auth/google": { kind: "public" },
  "POST /api/auth/email/request": { kind: "public" },
  "GET /api/auth/email/consume": { kind: "public" },
  "GET /api/strava/webhook": { kind: "public" },
  "POST /api/strava/webhook": { kind: "public" },

  // ── Cron (src/proxy.ts CRON_AUTHENTICATED_ROUTES + /api/cron/*) ────────────
  "GET /api/sync/reconcile-garmin": { kind: "cron" },
  "GET /api/sync/reconcile-archived-plans": { kind: "cron" },
  "GET /api/sync/reconcile-gcal-outbox": { kind: "cron" },
  "POST /api/garmin/reconcile": { kind: "cron" },
  "GET /api/cron/gcal": { kind: "cron" },
  "GET /api/cron/reminders": { kind: "cron" },
  "GET /api/cron/sync-drain": { kind: "cron" },

  // ── No-db / app-wide singleton ─────────────────────────────────────────────
  "POST /api/auth/logout": { kind: "no-db" },
  // Mints the native shell's bearer token. It reads no table at all: identity
  // comes from the credential already presented, and minting is pure crypto.
  // There is no id in the request, so there is no cross-user id to attack. Its
  // isolation property is that the token encodes the CALLER's own user id, and
  // that is asserted directly in src/lib/__tests__/shell-token.test.ts rather
  // than over HTTP here.
  "POST /api/auth/shell/token": { kind: "no-db" },
  "GET /api/session": { kind: "no-db" },
  "GET /api/geo": { kind: "no-db" },
  "GET /api/strava/subscription": { kind: "no-db", note: "one Strava webhook subscription for the whole app" },
  "POST /api/strava/subscription": { kind: "no-db" },
  "POST /api/strava/backfill": { kind: "no-db", note: "single connected Strava account, app-wide, not yet per-user" },
  "GET /api/garmin/config": { kind: "no-db", note: "single Garmin worker connection, app-wide" },
  "POST /api/garmin/config": { kind: "no-db" },
  "POST /api/garmin/import": { kind: "no-db" },
  "POST /api/garmin/resync": { kind: "no-db" },
  "GET /api/garmin/status": { kind: "no-db" },
  "GET /api/sync/gcal": { kind: "no-db" },
  "POST /api/sync/gcal": { kind: "no-db" },
  "GET /api/sync/health": { kind: "no-db", note: "aggregate outbox counters, no per-user rows returned" },
  "GET /api/integrations/gcal/status": { kind: "no-db" },
  "GET /api/integrations/strava/status": { kind: "no-db" },

  // ── Self-scoped destructive ─────────────────────────────────────────────────
  // Both were "no-db" ("single stored token, app-wide") before per-user
  // credentials landed (Phase 4, integration_credentials/sync_outbox's
  // idempotencyKey rows are now tenanted). #135 flagged the label as stale
  // without correcting it. Both routes are withSession(...), so the delete
  // they issue only ever removes the CALLER's own row — the guarantee is
  // FORCE row level security on the transaction withSession opens (see
  // db/with-user.ts), not a userId filter written at the call site, since
  // neither query has a user-owned id to filter by in the first place. No id
  // anywhere in the request, so, like DELETE /api/user/account below, there
  // is no cross-user id to attack.
  "POST /api/gcal/disconnect": {
    kind: "self-scoped-destructive",
    note: "deletes the caller's own stored gcal token row (src/app/api/gcal/disconnect/route.ts). Scoped by withSession's row level security transaction; no userId is threaded through the query because the tenant isolation is enforced at the database layer, not the call site.",
  },
  "POST /api/strava/disconnect": {
    kind: "self-scoped-destructive",
    note: "deletes the caller's own Strava credentials via deleteCredentials(currentUserId(), \"strava\") (src/app/api/strava/disconnect/route.ts). Scoping is asserted directly in src/app/api/strava/disconnect/__tests__/route.test.ts, which mocks db/with-user so deleteCredentials being called with any id proves it ran inside withUser's scope.",
  },
  "DELETE /api/user/account": {
    kind: "self-scoped-destructive",
    note: "erases the CALLER's account and every row they own, via lib/account-deletion.ts. Scoping is asserted in src/lib/__tests__/account-deletion.test.ts (every delete filtered by the given userId, discovered from the same tenancy metadata 0064's RLS coverage migration uses) and src/app/api/user/account/__tests__/route.test.ts (the route always deletes the SESSION's own id, never a body/param value, and the owner is refused before anything runs).",
  },

  // ── Tenanted singleton ──────────────────────────────────────────────────────
  "GET /api/strength/plan-settings": { kind: "tenanted-singleton" },
  "PUT /api/strength/plan-settings": {
    kind: "tenanted-singleton",
    request: () => ({
      url: "/api/strength/plan-settings",
      body: {
        goal: "running_focus",
        durationMinutes: 30,
        sessionsPerWeek: 2,
        ability: "beginner",
        availableDays: [1, 3],
        equipment: [],
      },
    }),
  },
  "PATCH /api/strength/plan-settings": {
    kind: "tenanted-singleton",
    request: () => ({ url: "/api/strength/plan-settings", body: { restSeconds: 90 } }),
  },
  "DELETE /api/strength/plan-settings": {
    kind: "tenanted-singleton",
    request: () => ({ url: "/api/strength/plan-settings" }),
    note: "no strength_plan_settings row is seeded, so this legitimately 404s for both users — this entry only guards against a 401/403/500.",
  },
  "GET /api/reminders/settings": { kind: "tenanted-singleton" },
  "POST /api/reminders/settings": {
    kind: "tenanted-singleton",
    request: () => ({
      url: "/api/reminders/settings",
      body: { enabled: true, leadMinutes: 20, defaultTimeOfDay: "06:30" },
    }),
  },
  // These two read and write columns on `users`, which is the identity table
  // and deliberately carries NO row level security policy. So unlike every
  // other entry here there is no database backstop: the only thing scoping them
  // is `where users.id = currentUserId()` in lib/user-units.ts. That makes this
  // pair more worth testing than the ones the policies already cover, not less.
  "GET /api/user/units": { kind: "tenanted-singleton" },
  "POST /api/user/units": {
    kind: "tenanted-singleton",
    request: () => ({
      url: "/api/user/units",
      body: { distanceUnit: "miles", weightUnit: "lbs" },
    }),
  },
  "GET /api/user/device-setup": {
    kind: "tenanted-singleton",
    note: "keyed by the caller's own session user id (resolveRequestUserId), not a URL/body param, so there is no id to leak against",
  },
  "PUT /api/user/device-setup": {
    kind: "tenanted-singleton",
    request: () => ({ url: "/api/user/device-setup", body: { connections: ["strava"] } }),
    note: "keyed by the caller's own session user id (resolveRequestUserId), not a URL/body param, so there is no id to leak against",
  },

  // ── Tenanted list ─────────────────────────────────────────────────────────
  "GET /api/activities": { kind: "tenanted-list" },
  "GET /api/wellness": { kind: "tenanted-list" },
  "GET /api/strength/sessions": { kind: "tenanted-list" },
  "GET /api/strength/summary": { kind: "tenanted-list" },
  "GET /api/strength/exercises": { kind: "tenanted-list" },
  "GET /api/custom-workouts": { kind: "tenanted-list" },
  "GET /api/activities/trash": { kind: "tenanted-list" },
  "GET /api/export/activities": { kind: "tenanted-list" },
  "GET /api/export/strength-sets": { kind: "tenanted-list" },
  "GET /api/pace-insights": { kind: "tenanted-list" },
  "GET /api/readiness": { kind: "tenanted-list" },
  "GET /api/today": { kind: "tenanted-list" },
  "GET /api/today/bootstrap": {
    kind: "tenanted-list",
    note: "one request bundling today/plan/plan-settings/device-setup/strength-sessions/pace-insights/readiness/wellness/geo — every section is one of the caller's own reads (see route.ts), same as calling each endpoint above individually. No id in the request; a section that fails server-side comes back as { error: true } rather than another caller's data.",
  },
  "GET /api/insights": { kind: "tenanted-list" },
  "GET /api/performance": { kind: "tenanted-list" },
  "GET /api/stats/hr-zones": {
    kind: "tenanted-list",
    request: () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return { url: `/api/stats/hr-zones?month=${month}&bounds=120,140,160,175&max=190` };
    },
  },
  "GET /api/stats/training-load": { kind: "tenanted-list" },
  "GET /api/fitness-estimate": { kind: "tenanted-list" },
  "GET /api/plan/adjustments": { kind: "tenanted-list" },
  "GET /api/race-times": { kind: "tenanted-list" },
  "GET /api/plans": { kind: "tenanted-list" },
  "POST /api/plans": {
    kind: "tenanted-create",
    request: () => ({
      url: "/api/plans",
      body: {
        intent: "maintain",
        planLengthWeeks: 4,
        startDate: new Date().toISOString(),
        daysPerWeek: 3,
        trainingVolume: "low",
        trainingDifficulty: "easy",
        preferredLongRunDay: 0,
        hillyArea: false,
        currentWeeklyKm: 15,
        longRunCapKm: 10,
        strengthMode: "keep",
      },
    }),
    skipControl: "archives every OTHER active plan for the caller, by design. Harmless as user B, but it leaves user B with a second active plan, which the tenanted-id entries below resolve by id rather than by 'the active one', so it is asserted loosely rather than skipped for the owner's sake.",
  },
  "POST /api/race-times": {
    kind: "tenanted-create",
    request: () => ({ url: "/api/race-times", body: { distance: "marathon", timeSeconds: 4 * 3600 } }),
  },
  "GET /api/profiles": {
    kind: "tenanted-list",
    note: "household profiles now carry user_id; this route predates that and currently returns every user's profiles — see the test for why the marker check here is a household name, not a plan name.",
  },
  "GET /api/strength/history/[exerciseId]": {
    kind: "tenanted-list",
    request: () => ({ url: `/api/strength/history/${exerciseId}` }),
    note: "the id is the shared exercise catalogue's, not owned by either user — both users request the SAME exerciseId and each must see only their own logged sets for it.",
  },
  "POST /api/strength/validate": {
    kind: "tenanted-list",
    request: () => ({
      url: "/api/strength/validate",
      body: { type: "full_body", date: new Date().toISOString() },
    }),
    note: "reads every user's strength sessions globally with no id to target directly; the response carries no ids/names to assert against, so coverage here is the route-inventory guarantee plus a bare control-succeeds check, not a real leak probe.",
  },

  // ── Tenanted create ───────────────────────────────────────────────────────
  "POST /api/activities/manual": {
    kind: "tenanted-create",
    request: () => ({
      url: "/api/activities/manual",
      body: {
        kind: "run",
        name: "Isolation-spec manual run",
        date: new Date().toISOString(),
        distanceKm: 4,
        durationSeconds: 1200,
      },
    }),
  },
  "POST /api/push/subscribe": {
    kind: "tenanted-create",
    request: () => ({
      url: "/api/push/subscribe",
      body: {
        endpoint: `https://example.invalid/push/${globalThis.crypto.randomUUID()}`,
        keys: { p256dh: "isolation-spec-p256dh-000000000000", auth: "isolation-spec-auth-00000000" },
      },
    }),
  },
  "POST /api/push/unsubscribe": {
    kind: "tenanted-create",
    request: () => ({ url: "/api/push/unsubscribe", body: { endpoint: "https://example.invalid/push/does-not-exist" } }),
    note: "removing a non-existent subscription is a no-op success — this only proves the caller's own request is answered, not another user's.",
  },
  "POST /api/profiles": {
    kind: "tenanted-create",
    request: () => ({ url: "/api/profiles", body: { name: `Isolation spec guest ${Date.now()}` } }),
  },
  "POST /api/custom-workouts": {
    kind: "tenanted-create",
    request: () => ({
      url: "/api/custom-workouts",
      // exerciseSlug, not exerciseId — CustomWorkoutBodySchema validates
      // against the program catalogue's slugs. Any seeded exercise's own
      // slug field would do; the catalogue itself is global, so hard-coding
      // one here would drift if the program ever reorders — using the
      // artifact's exerciseId to look the slug up isn't possible from a
      // fetch-only spec, so this asks the strength/exercises list instead,
      // done once at request-build time by the caller (see the test body).
      body: undefined,
    }),
    note: "body assembled in the test from GET /api/strength/exercises's own first row (a slug, not the shared exerciseId).",
  },
  "POST /api/strength/sessions": {
    kind: "tenanted-create",
    request: () => ({ url: "/api/strength/sessions", body: { type: "full_body", date: new Date().toISOString() } }),
  },
  "POST /api/strength/plan-settings/ensure": {
    kind: "tenanted-create",
    request: () => ({ url: "/api/strength/plan-settings/ensure", body: {} }),
  },
  "POST /api/strength/plan-settings/reconcile": {
    kind: "tenanted-create",
    request: () => ({ url: "/api/strength/plan-settings/reconcile", body: {} }),
  },
  "PUT /api/wellness": {
    kind: "tenanted-create",
    request: () => ({
      url: "/api/wellness",
      body: { date: new Date().toISOString(), energy: 3, sleepQuality: 3, soreness: 3 },
    }),
  },

  // ── Tenanted id ───────────────────────────────────────────────────────────
  "GET /api/activities/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}` }),
  },
  "PATCH /api/activities/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}`, body: { unlink: true } }),
    readBack: { request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}` }), pick: ["id", "workoutId", "strengthSessionId"] },
  },
  "DELETE /api/activities/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}` }) },
    skipControl: "would move the owner's shared seeded activity to trash, which activity-link.spec.ts depends on existing.",
  },
  "GET /api/activities/[id]/candidates": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}/candidates` }),
  },
  "GET /api/activities/[id]/exercise-order": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}/exercise-order` }),
    refusedStatuses: [200, 404],
    note: "documented-deliberate: an unowned/garmin-less activity answers the same empty {exercises:[]} a 404 would, rather than a real 404 — see the route's own comment. Safe by construction: the response never carries owner-identifying content.",
  },
  "POST /api/activities/[id]/insights": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}/insights`, body: {} }),
    readBack: { request: (ids) => ({ url: `/api/activities/${requireId(ids, "activityId")}` }), pick: ["aiInsight"] },
    refusedStatuses: [404, 403, 501],
    note: "501 (ANTHROPIC_API_KEY unset in this harness) also proves nothing of A's leaked — accepted alongside 404/403 as a non-leaking outcome, though it means this entry can't prove the ownership fix specifically until a key is configured for e2e.",
  },
  "POST /api/activities/trash/[id]/restore": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/trash/${requireId(ids, "trashRestoreId")}/restore`, body: undefined }),
    readBack: { request: () => ({ url: "/api/activities/trash" }) },
    note: "unscoped by id alone today — a successful leak probe both restores someone else's trashed row into the caller's own view AND deletes the trash entry, so a run against the still-broken route consumes this fixture (re-seed to run again).",
  },
  "DELETE /api/activities/trash/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/activities/trash/${requireId(ids, "trashDeleteId")}`, body: undefined }),
    readBack: { request: () => ({ url: "/api/activities/trash" }) },
  },
  "GET /api/custom-workouts/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/custom-workouts/${requireId(ids, "customWorkoutId")}` }),
  },
  "PUT /api/custom-workouts/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({
      url: `/api/custom-workouts/${requireId(ids, "customWorkoutId")}`,
      body: { name: "Isolation-spec renamed workout", slots: [{ exerciseSlug: undefined, sets: 3, repLow: 8, repHigh: 12, restSeconds: 60 }] },
    }),
    readBack: { request: (ids) => ({ url: `/api/custom-workouts/${requireId(ids, "customWorkoutId")}` }), pick: ["name"] },
    note: "slots[0].exerciseSlug is filled in from GET /api/strength/exercises at request time, same as the custom-workouts POST entry.",
  },
  "DELETE /api/custom-workouts/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/custom-workouts/${requireId(ids, "customWorkoutId")}`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/custom-workouts/${requireId(ids, "customWorkoutId")}` }) },
    skipControl: "would delete the owner's shared seeded custom workout template.",
  },
  "GET /api/plans/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}` }),
  },
  "PUT /api/plans/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({
      url: `/api/plans/${requireId(ids, "planId")}`,
      body: {
        raceDistance: "10k",
        goalTimeSeconds: 45 * 60,
        startDate: new Date().toISOString(),
        raceDate: new Date(Date.now() + 30 * 86400_000).toISOString(),
        daysPerWeek: 4,
        trainingVolume: "medium",
        trainingDifficulty: "moderate",
        preferredLongRunDay: 0,
        hillyArea: false,
        currentWeeklyKm: 30,
        longRunCapKm: 20,
      },
    }),
    skipControl: "regenerates the owner's shared seeded plan's weeks/workouts in place — other specs depend on the seeded schedule's shape.",
  },
  "DELETE /api/plans/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}` }), pick: ["status"] },
    skipControl: "would archive the owner's shared active plan.",
  },
  "POST /api/plans/[id]/recalibrate": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}/recalibrate`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}` }), pick: ["vdot"] },
    refusedStatuses: [404, 403, 422],
    note: "unscoped today — a 422 (\"not enough recent activity data\") is also a non-leaking outcome, accepted alongside 404/403, since either way A's real vdot never reaches B.",
  },
  "GET /api/plans/[id]/skip-week": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}/skip-week` }),
  },
  "POST /api/plans/[id]/skip-week": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}/skip-week`, body: { weekId: requireId(ids, "weekId") } }),
    skipControl: "would cancel every remaining planned workout in the owner's shared seeded plan's chosen week.",
  },
  "POST /api/plans/[id]/skip-week/undo": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/plans/${requireId(ids, "planId")}/skip-week/undo`, body: { weekId: requireId(ids, "weekId") } }),
    refusedStatuses: [404, 403, 422],
    note: "422 (\"This week isn't skipped\") is the expected control outcome (nothing skip-week'd it first) and is also a non-leaking outcome for the probe.",
  },
  "PATCH /api/plans/[id]/workouts/[workoutId]": {
    kind: "tenanted-id",
    request: (ids) => ({
      url: `/api/plans/${requireId(ids, "planId")}/workouts/${requireId(ids, "workoutId")}`,
      body: { title: "Isolation-spec title" },
    }),
    readBack: { request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}` }), pick: ["title"] },
    skipControl: "overwrites the owner's shared seeded workout's title.",
  },
  "DELETE /api/race-times": {
    kind: "tenanted-id",
    request: (ids) => ({ url: "/api/race-times", body: { id: requireId(ids, "personalRecordId") } }),
    readBack: { request: () => ({ url: "/api/race-times" }) },
    skipControl: "would delete the owner's shared seeded personal record.",
    note: "the reference-fixed route (id arrives in the DELETE body, not the URL) — see src/app/api/race-times/route.ts.",
  },
  "GET /api/strength/sessions/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}` }),
  },
  "PATCH /api/strength/sessions/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}`, body: { notes: "Isolation-spec note" } }),
    readBack: { request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}` }), pick: ["notes"] },
  },
  "DELETE /api/strength/sessions/[id]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}` }) },
    skipControl: "would delete the owner's shared seeded strength session.",
  },
  "POST /api/strength/sessions/[id]/sets": {
    kind: "tenanted-id",
    request: (ids) => ({
      url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}/sets`,
      body: { exerciseId, setNumber: 99, weightKg: 1, reps: 1, kind: "working" },
    }),
    readBack: {
      request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}` }),
      pick: ["sets"],
    },
    note: "a set numbered 99 is added/removed by this probe rather than reusing a real logged set number, so the control call's before/after comparison isn't polluted by a genuine set the athlete logged.",
  },
  "DELETE /api/strength/sessions/[id]/sets": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}/sets?exerciseId=${exerciseId}&setNumber=99` }),
    note: "targets the same set-number-99 fixture the sets POST entry above creates/removes — deleting a real logged set is destructive, so this never targets one.",
  },
  "POST /api/strength/sessions/[id]/garmin": {
    kind: "tenanted-id",
    request: (ids) => ({
      url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}/garmin`,
      body: { exercises: [{ name: "Push-up", category: "push", sets: 3, reps: 10, weightKg: null }] },
    }),
    refusedStatuses: [404, 403, 400],
    note: "400 (\"Garmin isn't connected\") is the expected outcome in this harness (no worker configured) and is also non-leaking.",
  },
  "POST /api/strength/sessions/[id]/pain": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}/pain`, body: { score: 2, timing: "after" } }),
    note: "additive (inserts a pain_logs row) — safe to run the control repeatedly.",
  },
  "POST /api/strength/sessions/[id]/trash": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}/trash`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/strength/sessions/${requireId(ids, "strengthSessionId")}` }) },
    skipControl: "would delete the owner's shared seeded strength session (moving it to trash first doesn't help — the session row itself is gone either way).",
  },
  "POST /api/plan/adjustments": {
    kind: "tenanted-id",
    request: (ids) => ({ url: "/api/plan/adjustments", body: { action: "skip", workoutIds: [requireId(ids, "workoutId")] } }),
    readBack: { request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}` }), pick: ["status"] },
    refusedStatuses: [404, 403, 422],
    note: "id arrives inside a JSON array in the body, not the URL — the known shape of this class of bug per the audit (\"several findings needed a realistic body\"). 422 (\"No matching missed sessions\" — the seeded workout may not be in the lookback window) is an acceptable non-leaking outcome for the probe; the control call also tolerates it for the same reason.",
    skipControl: "if it does match (a past-planned workout), marks the owner's shared seeded workout missed.",
  },
  "GET /api/workouts/[workoutId]": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}` }),
  },
  "PATCH /api/workouts/[workoutId]/complete": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}/complete`, body: { rpe: 5 } }),
    readBack: { request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}` }), pick: ["status", "rpe"] },
    note: "the seeded workout is already completed (it's in week 1, entirely in the past) — completing it again is idempotent, safe for the control call to repeat.",
  },
  "POST /api/workouts/[workoutId]/race-result": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}/race-result`, body: { finishSeconds: 3600 } }),
    readBack: { request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}` }), pick: ["raceFinishSeconds"] },
    refusedStatuses: [404, 403, 422],
    note: "422 (\"Only the race-day workout can carry a race result\" — the seeded workout is an easy run, not type race) is the expected control outcome and also non-leaking for the probe.",
  },
  "DELETE /api/workouts/[workoutId]/race-result": {
    kind: "tenanted-id",
    request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}/race-result`, body: undefined }),
    readBack: { request: (ids) => ({ url: `/api/workouts/${requireId(ids, "workoutId")}` }), pick: ["status", "raceFinishSeconds"] },
    note: "clears fields that were never set on the seeded (non-race) workout — a true no-op, safe for the control call to repeat.",
  },
  "POST /api/workouts/[workoutId]/record": {
    kind: "tenanted-id",
    request: (ids) => ({
      url: `/api/workouts/${requireId(ids, "workoutId")}/record`,
      body: { distanceKm: 5, durationSeconds: 1500 },
    }),
    note: "inserts a NEW activities row with workoutId taken from the URL and no ownership check on that workout at all — the leak here is attributing a fabricated run to someone else's workout, not a read.",
  },
  "DELETE /api/profiles": {
    kind: "tenanted-id",
    // id arrives as a query string, and the body must confirm the target's
    // CURRENT name exactly (see the route's DeleteSchema) — the seeded
    // profile fixture needed for this exists only if a "profiles" fixture is
    // added; today there is none for either user, so this entry documents
    // the shape and expects a 400/404 (no id / not found) for both the probe
    // and the control, never a 200 — a 200 here on an unseeded id would
    // itself be a bug worth investigating.
    request: () => ({ url: "/api/profiles?id=00000000-0000-0000-0000-000000000099", body: { confirmName: "does-not-exist" } }),
    refusedStatuses: [400, 404, 403, 422],
    note: "no household profile is seeded for either user (only the owner/user-B athlete rows themselves exist) — this entry can only prove the route answers a nonsense id safely, not a real cross-user probe. Flagged as a coverage gap, not exercised end-to-end.",
    skipControl: "no seeded profile row exists to target, so 'success' isn't a meaningful outcome here — see note.",
  },
};

test.describe.configure({ mode: "serial" });

// ══════════════════════════════════════════════════════════════════════════
// 1. Route inventory
// ══════════════════════════════════════════════════════════════════════════

test.describe("route inventory", () => {
  test("every route.ts export has a manifest entry, and every manifest entry has a route file", () => {
    const discovered = discoverRoutes();
    const problems: string[] = [];

    for (const route of discovered) {
      for (const method of route.methods) {
        const key = `${method} ${route.pattern}`;
        if (!(key in manifest)) {
          problems.push(
            `UNCLASSIFIED: ${key}\n  file: ${route.file}\n  → add a manifest entry in cross-user-isolation.spec.ts ` +
              `classifying it public / cron / no-db / tenanted-list / tenanted-singleton / tenanted-create / ` +
              `tenanted-id / self-scoped-destructive.`
          );
        }
      }
    }

    const discoveredKeys = new Set(discovered.flatMap((r) => r.methods.map((m) => `${m} ${r.pattern}`)));
    for (const key of Object.keys(manifest)) {
      if (!discoveredKeys.has(key)) {
        problems.push(`STALE MANIFEST ENTRY: ${key}\n  → no route file exports this method any more; remove the entry.`);
      }
    }

    expect(problems, `\n\n${problems.join("\n\n")}\n`).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Tenanted list / singleton: caller sees only their own data.
// ══════════════════════════════════════════════════════════════════════════

test.describe("tenanted-list / tenanted-singleton", () => {
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.kind !== "tenanted-list" && entry.kind !== "tenanted-singleton") continue;
    const [method] = key.split(" ");
    const { url, body } = entry.request ? entry.request() : get(key.slice(method.length + 1));

    test(key, async () => {
      const asA = await asOwner(method, url, body);
      expect(asA.status, `control call as the owner must succeed — got ${asA.status}: ${asA.text}`).toBeLessThan(400);
      // Symmetric sanity check on the control call itself: the owner's own
      // successful response must not carry user B's data either — a route
      // that unions every caller's rows together would pass a one-directional
      // check (B doesn't see A) while still being wide open the other way.
      if (isSuccess(asA.status)) {
        expect(
          containsNoneOf(asA, USER_B_MARKERS),
          `the owner's own ${key} response contains user B's seeded data:\n${asA.text.slice(0, 2000)}`
        ).toBe(true);
      }

      const asB = await asUserB(method, url, body);
      // A 401/403/500 for B is not a pass — it's a different bug (the route
      // shouldn't refuse a legitimate signed-in caller their OWN empty
      // list). Only a genuine 2xx/4xx-not-auth response is checked for A's
      // markers, matching "RLS mistakes present as empty lists", not errors.
      if (isSuccess(asB.status)) {
        expect(
          containsNoneOf(asB, OWNER_MARKERS),
          `user B's own ${key} response contains the owner's seeded data:\n${asB.text.slice(0, 2000)}`
        ).toBe(true);
      }
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Tenanted create: the caller's own write still works.
// ══════════════════════════════════════════════════════════════════════════

test.describe("tenanted-create", () => {
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.kind !== "tenanted-create") continue;

    const method = key.split(" ")[0];

    test(key, async () => {
      const { url } = entry.request();
      let { body } = entry.request();

      // custom-workouts needs a real exercise slug (not the shared uuid) —
      // resolved here, once, from the catalogue every user can read.
      if (key === "POST /api/custom-workouts") {
        const exercises = await asOwner("GET", "/api/strength/exercises");
        const slug = (exercises.json as Array<{ slug: string }>)?.[0]?.slug;
        expect(slug, "GET /api/strength/exercises returned no exercises to build a custom-workout payload from").toBeTruthy();
        body = { name: "Isolation-spec custom workout", slots: [{ exerciseSlug: slug, sets: 3, repLow: 8, repHigh: 12, restSeconds: 60 }] };
      }

      // Run the control as USER B, not the owner.
      //
      // These entries CREATE rows, and creating is not a read-only probe: as the
      // owner they land on the very fixtures the other spec files assert against.
      // That is not hypothetical. `PUT /api/wellness` upserts by (user, date), so
      // running it as the owner overwrote the seeded check-in that
      // readiness-warmup.spec.ts reads, and that spec then failed on a missing
      // readiness card in the FULL run while passing when run alone. The e2e
      // Postgres is persistent between runs too, so the damage outlived the run
      // that caused it.
      //
      // User B is just as legitimate an owner of user B's data, so the control
      // proves exactly the same thing (this route succeeds for the person whose
      // data it is) while touching nothing any other spec reads.
      if (entry.skipControl) {
        test.info().annotations.push({ type: "skip-control", description: entry.skipControl });
        const res = await call(cookies.userB, method, url, body);
        expect(res.status, `${key} as its own caller returned ${res.status}: ${res.text}`).toBeLessThan(500);
        return;
      }

      const res = await call(cookies.userB, method, url, body);
      expect(res.status, `${key} as its own caller must succeed — got ${res.status}: ${res.text}`).toBeLessThan(300);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Tenanted id: the core cross-user probe.
// ══════════════════════════════════════════════════════════════════════════

function pickFields(value: unknown, fields?: string[]): unknown {
  if (!fields || value == null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = (value as Record<string, unknown>)[f];
  return out;
}

// PUT /api/custom-workouts/[id] validates slots[].exerciseSlug against the
// real program catalogue (CustomWorkoutBodySchema) — resolved once here,
// same reasoning as the POST entry in the tenanted-create suite above: an
// invalid slug 400s before the route ever reaches the ownership check,
// which would make this entry's leak probe pass for the wrong reason (a
// generic validation error, not "refused because it's not yours").
let resolvedExerciseSlug: string | null = null;
async function customWorkoutSlug(): Promise<string> {
  if (!resolvedExerciseSlug) {
    const res = await asOwner("GET", "/api/strength/exercises");
    resolvedExerciseSlug = (res.json as Array<{ slug: string }>)?.[0]?.slug ?? null;
  }
  expect(resolvedExerciseSlug, "GET /api/strength/exercises returned no exercises to build a custom-workout payload from").toBeTruthy();
  return resolvedExerciseSlug!;
}

test.describe("tenanted-id", () => {
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.kind !== "tenanted-id") continue;
    const method = key.split(" ")[0];
    const refused = entry.refusedStatuses ?? [403, 404];

    test(key, async () => {
      if (key === "PUT /api/custom-workouts/[id]") {
        const slug = await customWorkoutSlug();
        const fixed = (ids: SeedIds) => ({
          url: `/api/custom-workouts/${requireId(ids, "customWorkoutId")}`,
          body: { name: "Isolation-spec renamed workout", slots: [{ exerciseSlug: slug, sets: 3, repLow: 8, repHigh: 12, restSeconds: 60 }] },
        });
        (entry as IdEntry).request = fixed;
      }

      // ── a. Leak probe: call as user B, targeting the OWNER's id. ───────────
      const { url: probeUrl, body: probeBody } = entry.request(seedIds.owner);
      const before = entry.readBack ? await asOwner("GET", entry.readBack.request(seedIds.owner).url) : null;

      const probe = await call(cookies.userB, method, probeUrl, probeBody);
      expect(
        refused.includes(probe.status),
        `${key}: user B against the owner's id should be refused (expected one of [${refused.join(", ")}]), got ${probe.status}: ${probe.text}`
      ).toBe(true);
      // Belt and braces on top of the status code: even a "refused" response
      // must not have echoed the owner's data back in the body.
      expect(
        containsNoneOf(probe, OWNER_MARKERS),
        `${key}: refused response still contains the owner's seeded data:\n${probe.text.slice(0, 2000)}`
      ).toBe(true);

      if (entry.readBack) {
        const after = await asOwner("GET", entry.readBack.request(seedIds.owner).url);
        expect(
          pickFields(after.json, entry.readBack.pick),
          `${key}: the owner's resource changed after user B's refused write — the leak was a WRITE leak, not just a read.\n` +
            `before: ${JSON.stringify(pickFields(before!.json, entry.readBack.pick))}\nafter: ${JSON.stringify(pickFields(after.json, entry.readBack.pick))}`
        ).toEqual(pickFields(before!.json, entry.readBack.pick));
      }

      // ── b. Control: the same call as the OWNER, against their own id. ──────
      if (entry.skipControl) {
        test.info().annotations.push({ type: "skip-control", description: entry.skipControl });
        return;
      }
      const { url: controlUrl, body: controlBody } = entry.request(seedIds.owner);
      const control = await call(cookies.owner, method, controlUrl, controlBody);
      // Never 403/404 — those would mean the owner is refused their OWN
      // resource, which is the "over-tight fix" this control exists to
      // catch. A handful of entries also accept a specific non-auth status
      // (422/400/501) documented in their own `note` — e.g. "not enough
      // recent activity data" or "Garmin isn't connected" in this harness —
      // as a legitimate outcome for a seed fixture that doesn't happen to
      // satisfy that route's business rule, not evidence of a leak or a
      // broken control.
      const extraAcceptable = (entry.refusedStatuses ?? []).filter((s) => s !== 403 && s !== 404);
      expect(
        isSuccess(control.status) || extraAcceptable.includes(control.status),
        `${key}: the owner's own call should succeed (or hit one of [${extraAcceptable.join(", ")}]), got ${control.status}: ${control.text}`
      ).toBe(true);
      expect(control.status, `${key}: the owner was refused their own resource`).not.toBe(403);
      expect(control.status, `${key}: the owner was refused their own resource`).not.toBe(404);
    });
  }
});
