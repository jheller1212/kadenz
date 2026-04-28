# ADR-0001: Use garth for Garmin Connect Integration

**Date**: 2026-04-28  
**Status**: Accepted  
**Deciders**: Jonas Heller

---

## Context

Kadenz needs to pull completed running activities from Garmin Connect to match them against planned workouts and mark workouts as completed. This closes the feedback loop between planned training and actual execution.

Garmin does not provide a public API for Garmin Connect. Their official developer program ([Garmin Health API](https://developer.garmin.com/health-api/overview/)) is restricted to commercial healthcare partners and is not available for personal tools.

---

## Decision

Use [`garth`](https://github.com/matin/garth) (v0.8+), a Python library that reverse-engineers the Garmin Connect SSO authentication flow and wraps the internal Garmin Connect API endpoints.

`garth` will be isolated in the `garmin-worker` FastAPI service. The web layer communicates with the worker over HTTP with a shared secret (`WORKER_SECRET`). The worker has no direct DB access.

---

## Alternatives Considered

### 1. Garmin Health API (official)
- **Rejected**: Requires commercial partnership approval. Not available for personal tools.

### 2. Manual CSV/FIT file import
- **Rejected**: Requires user action for every activity. Breaks the "automatic sync" goal.

### 3. Strava as intermediary
- **Partially adopted**: Strava webhooks are used for Strava-connected users, but not all users have Strava or sync Garmin → Strava.

### 4. garminconnect Python library
- **Considered**: Similar approach to `garth`, also reverse-engineered. `garth` is more actively maintained and has better session token caching (avoids re-authenticating every request). `garth` chosen over `garminconnect`.

### 5. No Garmin sync
- **Rejected**: Garmin is the primary device platform for the target user. Without sync, workout completion tracking requires manual entry.

---

## Consequences

### Positive
- Full automatic activity sync from Garmin Connect without user interaction after initial setup
- `garth` handles session token caching, so the Garmin password is only used once for initial auth
- Isolated in its own worker service; easy to disable or replace

### Negative / Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Garmin changes SSO flow, breaking `garth` | Medium | High | Monitor `garth` releases; surface clear error to user rather than crashing; fallback to manual activity entry |
| Garmin blocks the account for automation | Low | High | Rate-limit to max 1 sync/hour; use the user's own credentials for the user's own data |
| ToS violation | Low | Medium | Personal, non-commercial, single-user; not redistributing data; acceptable risk |
| `garth` library abandoned | Low | Medium | MIT license; can fork and maintain if needed; `garminconnect` is a fallback |

---

## Implementation Notes

- Garmin credentials (`GARMIN_EMAIL`, `GARMIN_PASSWORD`) stored in `garmin-worker/.env` only — never in the database
- Token cache stored at a path outside the repo (configured via `GARMIN_TOKEN_STORE` env var)
- Worker endpoint protected by `WORKER_SECRET` header
- Auth errors surfaced to the web layer with a clear status code; UI prompts user to re-authenticate if needed
- Sync frequency: on-demand via UI button + optional background schedule (max 1/hour)
