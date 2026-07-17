# Kadenz Garmin Worker

Thin FastAPI service bridging Kadenz and Garmin Connect (via [garth](https://github.com/matin/garth)):

- **Push**: structured running workouts and strength workouts, scheduled to a date
- **Pull**: activity list + activity detail with normalized km splits

All inbound requests require `Authorization: Bearer <WORKER_TOKEN>`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no auth) |
| GET | `/activities?since=<ISO>&limit=<n>` | List activities, newest first (`limit` 1-200, default 20) |
| GET | `/activities/{garminId}` | Activity detail incl. `splits` + `lapCount` |
| POST | `/workouts` | Create + schedule a structured running workout |
| POST | `/strength-workouts` | Create + schedule a strength workout |
| PATCH | `/workouts/{id}` | Reschedule a workout |
| DELETE | `/workouts/{id}` | Delete a workout (any sport type, incl. strength) |

Error contract: `502 {"detail": "Garmin API error: ..."}` for Garmin failures; `503 {"error": "garmin_auth"}` when the Garmin session is dead even after a re-login attempt (web side should surface "reconnect Garmin").

### Activity shape (list item; detail adds `splits` + `lapCount`)

```json
{
  "garminId": 111,
  "name": "Morning Run",
  "activityType": "trail_running",
  "kind": "run",
  "startTimeLocal": "2026-07-16 07:00:00",
  "startTimeGMT": "2026-07-16 05:00:00",
  "distanceMeters": 10000.0,
  "durationSeconds": 3000.0,
  "avgPaceSecPerKm": 300,
  "avgHr": 150.0,
  "maxHr": 172.0,
  "elevationGain": 85.0,
  "calories": 640.0
}
```

`kind`: `run` (running, treadmill_running, trail_running), `strength` (strength_training, indoor_cardio), else `other`. `avgPaceSecPerKm` is only derived for runs. Splits: `[{"distanceKm": 1.0, "durationSeconds": 290.0, "avgHr": 148.0, "avgPaceSecPerKm": 290}]` (empty array if unavailable).

### Strength workout request

```json
POST /strength-workouts
{
  "title": "Kraft A",
  "date": "2026-07-20",
  "exercises": [
    {"name": "Bench Press", "category": "bench_press", "sets": 3, "reps": 5, "weightKg": 60}
  ]
}
→ 201 {"garminWorkoutId": "555", "scheduleId": "777"}
```

Exercise names are mapped to Garmin's exercise taxonomy (curated map + category hint); unmappable exercises become generic strength steps with the name in the step description.

## Local development

```bash
uv sync
uv run pytest -q          # all Garmin calls are mocked
uv run uvicorn main:app --reload
```

Env vars (`.env` supported): `WORKER_TOKEN` (required), `GARTH_HOME` (default `~/.garth`), `GARMIN_EMAIL` / `GARMIN_PASSWORD` (only needed for the initial login; tokens are persisted afterwards).

## Deploy to Fly.io

```bash
cd garmin-worker

# 1. Create the app + volume (first time only; fly.toml is committed)
fly launch --no-deploy --copy-config --name kadenz-garmin-worker --region ams
fly volumes create garmin_data --region ams --size 1 -a kadenz-garmin-worker

# 2. Secrets. GARMIN_EMAIL/PASSWORD are used once on first boot to log in;
#    tokens are then persisted to the /data volume and the credentials are
#    no longer needed (you can unset them after a successful boot).
fly secrets set -a kadenz-garmin-worker \
  WORKER_TOKEN="$(openssl rand -hex 32)" \
  GARMIN_EMAIL="you@example.com" \
  GARMIN_PASSWORD="..."

# 3. Deploy
fly deploy -a kadenz-garmin-worker
```

If the Garmin account has MFA enabled, the headless password login will fail. Log in interactively on your machine instead and upload the tokens:

```bash
uv run python scripts/login_local.py      # prompts for email/password/MFA, writes ./garth-tokens
fly ssh console -a kadenz-garmin-worker -C "mkdir -p /data/garth"
fly ssh sftp shell -a kadenz-garmin-worker
>> put garth-tokens/oauth1_token.json /data/garth/oauth1_token.json
>> put garth-tokens/oauth2_token.json /data/garth/oauth2_token.json
fly machine restart -a kadenz-garmin-worker
```

Finally, point the web app at the worker (Vercel env vars):

```
GARMIN_WORKER_URL=https://kadenz-garmin-worker.fly.dev
GARMIN_WORKER_TOKEN=<the WORKER_TOKEN value>
```
