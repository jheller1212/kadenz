# Kadenz — Security & Threat Model

## Scope

Kadenz is a single-user, self-hosted running training-plan app. There is no public user registration. The primary attack surface is:

1. Inbound webhook endpoints (Strava)
2. Server-side OAuth token storage (Google Calendar, Strava)
3. Outbound reverse-engineered API access (Garmin Connect via `garth`)
4. Secret hygiene across the codebase and deployment environment

---

## 1. Garmin Connect (garth)

**Risk level: Medium**

`garth` uses reverse-engineered Garmin Connect SSO (form-based login flow, not an official API). Garmin publishes no public API for activity sync.

| Risk | Detail | Mitigation |
|---|---|---|
| Account block | Garmin can flag or suspend accounts using unofficial access | Rate-limit sync requests; default to once per hour or on-demand only |
| Auth breakage | Garmin may change their SSO flow at any time | Handle `GarthHTTPError` and auth failures gracefully; surface clear error to user rather than crashing |
| Credential exposure | Garmin username/password required for initial auth | **Never** store Garmin password in the database. Use env var (`GARMIN_PASSWORD`) only. `garth` caches session tokens to disk after first login — store token cache outside the repo |
| Token cache path | Default garth cache path may be in repo directory | Explicitly set `garth.configure(domain="garmin.com", token_store="/var/garmin-tokens")` or equivalent out-of-repo path |
| ToS | Garmin Connect ToS prohibits automated scraping | Personal use only, not a commercial product, not redistributing data; acceptable risk for single-user personal tool |

---

## 2. Strava Webhooks

**Risk level: Medium (webhook endpoint is public)**

Strava delivers `activity.create` events to a configured callback URL.

| Risk | Detail | Mitigation |
|---|---|---|
| Unverified webhook source | Any party can POST to the webhook endpoint | Verify every incoming request using `STRAVA_WEBHOOK_VERIFY_TOKEN` for the subscription challenge, and validate event shape before processing |
| Replay / spoofed events | Strava does not sign payloads with HMAC | Filter to `object_type: "activity"` and `aspect_type: "create"` only; treat incoming data as untrusted, always fetch the activity from Strava API to confirm before writing to DB |
| Subscription verification | Strava sends a GET with `hub.challenge` to verify the endpoint | Endpoint must respond with `{"hub.challenge": <value>}` and check `hub.verify_token` matches `STRAVA_WEBHOOK_VERIFY_TOKEN` |
| Access token scope | Strava OAuth must request `activity:read` scope minimum | Do not request write scopes unless required |

---

## 3. Google Calendar API

**Risk level: Low (server-side only)**

| Risk | Detail | Mitigation |
|---|---|---|
| Refresh token theft | OAuth refresh token stored server-side grants long-lived calendar write access | Store in env var or encrypted secret store, never in DB columns that appear in logs |
| Token rotation | Refresh tokens can be revoked by Google after 6 months of inactivity or policy change | Implement graceful re-auth flow; catch `invalid_grant` errors and prompt re-authorization |
| Scope creep | Requesting overly broad Google scopes | Request only `https://www.googleapis.com/auth/calendar.events` (not full calendar read/write) |
| Client secret exposure | `GOOGLE_CLIENT_SECRET` must never appear in client bundle | All Google API calls go through Next.js API routes (server-side only); verify `googleapis` is not imported in any `app/` client component |

---

## 4. Secret Hygiene

| Rule | Detail |
|---|---|
| All secrets in `.env` files | `.env.local` for web, `.env` for garmin-worker. Both are gitignored |
| No secrets in code | No hardcoded credentials, API keys, or tokens anywhere in source |
| No secrets in logs | Do not log request headers, auth tokens, or env vars |
| No secrets in client bundle | Next.js: only `NEXT_PUBLIC_*` vars are exposed to the browser. All sensitive vars must be unprefixed and used server-side only |
| `.env.example` files | Maintain `.env.example` in both `web/` and `garmin-worker/` with placeholder values and comments |

### Required env vars

**web/.env.local**
```
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_ACCESS_TOKEN=
STRAVA_REFRESH_TOKEN=
STRAVA_WEBHOOK_VERIFY_TOKEN=
GARMIN_WORKER_URL=
GARMIN_WORKER_SECRET=
```

**garmin-worker/.env**
```
GARMIN_EMAIL=
GARMIN_PASSWORD=
GARMIN_TOKEN_STORE=/var/garmin-tokens
WORKER_SECRET=
```

---

## 5. API Routes (Next.js)

Even as a single-user app, all API routes must:

- Validate request body shape with Zod before processing
- Return appropriate HTTP status codes (400 for bad input, 405 for wrong method)
- Not expose stack traces or internal error details in responses
- Webhook endpoints: validate origin tokens as described above

CSRF is not a primary concern for a PWA with no session cookies, but if cookies are introduced, `SameSite=Strict` should be set.

---

## 6. Dependency Security

- Run `npm audit` before each dependency update
- Pin major versions in `package.json`; do not use `*` or `latest`
- Python deps pinned via `uv.lock`
- Review any new dependency for license compatibility (see THIRD_PARTY.md) and known CVEs before adding
