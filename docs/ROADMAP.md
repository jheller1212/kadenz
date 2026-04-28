# Kadenz — Roadmap

## Phase 1 (current)

### Plan Engine
- VDOT calculator (Jack Daniels formula) from race result or time trial input
- Pace zones derived from VDOT: Easy, Marathon, Threshold, Interval, Repetition
- Periodization model: base → build → peak → taper cycles
- Workout generation: daily workout type, volume (km/miles), and target pace zone assigned per training day
- Weekly mileage progression with auto-cap and cutback weeks

### DB Schema (Drizzle + Postgres)
- `users` — single-user profile, VDOT, target race, preferences
- `training_plans` — plan metadata, phase, start/end dates
- `workouts` — individual scheduled workouts, type, distance, pace zone, status
- `completed_activities` — imported from Garmin/Strava, linked to workout
- `sync_tokens` — OAuth refresh tokens for Google Calendar and Strava

### Sync Layer
- **Google Calendar**: push workouts as calendar events via Google Calendar API (OAuth2, server-side token storage with refresh rotation)
- **Garmin Connect**: pull completed activities via `garmin-worker` (Python/FastAPI/garth); syncs on schedule or manual trigger
- **Strava webhooks**: receive `activity.create` events, validate signature, match to planned workout

### UI
- **Today screen**: current workout card, recent activity, weekly progress ring
- **Plan editor**: week-by-week grid with drag-drop reordering (`@dnd-kit`)
- **Plan creation wizard**: race date → VDOT input → plan preview → confirm
- **PWA**: service worker, offline Today screen, installable on mobile

---

## Phase 2 (future / not committed)

- Ultra marathon plan support (time-on-feet model, back-to-back long runs)
- Strength and cross-training sessions in plan
- Multi-race training blocks
- Analytics dashboard (pace trend, VDOT progression, training load)
- Heart rate zone integration
- Auto-adjust plan based on completed vs. missed workouts
