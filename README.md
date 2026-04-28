# Kadenz

> Lauftraining, strukturiert.

A personal, open-source running training-plan app for runners who already record their workouts with a Garmin watch and want a structured plan that adapts to a real schedule.

Kadenz generates weekly training plans for distances from 5k to marathon, syncs scheduled workouts to Google Calendar and Garmin Connect, and updates the plan automatically as completed activities flow back via Strava.

## Status

Personal project, built for one user. Not a product, not affiliated with any commercial running app, and not intended for public deployment. Released as open source so others can fork it for their own use.

## What it does

- Generates training plans based on VDOT and standard training paces (Jack Daniels)
- Edits weeks and workouts with drag-and-drop across weeks, validating training constraints (hard sessions spaced, long run anchored, deload and taper weeks preserved)
- Syncs outbound to Google Calendar (one event per workout, with full structure in the description) and to Garmin Connect (structured workouts with pace targets, scheduled to specific dates)
- Receives inbound activity data via Strava webhooks, runs pace analysis (actual vs target per block), and updates plan state
- Stores all training history in a Postgres database you control

## Stack

- Web: Next.js 15 (App Router), TypeScript, Tailwind, dnd-kit, Drizzle ORM
- Database: Postgres (Supabase or Neon free tier)
- Garmin worker: Python 3.12, FastAPI, garth
- Calendar: Google Calendar API
- Activity ingest: Strava webhooks

## Architecture

```
Browser (Next.js PWA)
    |
    +---> Next.js API routes ---> Postgres (Drizzle ORM)
    |         |
    |         +---> Google Calendar API
    |         +---> garmin-worker (FastAPI)
    |                    |
    |                    +---> Garmin Connect (via garth)
    |
    +---> Strava webhook ---> activity ingest ---> plan update
```

## License

MIT
