# Kadenz Cron Worker

A tiny Cloudflare Worker whose only job is to call two Kadenz cron endpoints
on a reliable schedule. It contains no business logic.

## Why this exists

Both `/api/cron/reminders` (workout push reminders) and
`/api/cron/sync-drain` (the watch/Google Calendar delivery safety net) were
driven by GitHub Actions `schedule: cron: "*/15 * * * *"`. GitHub documents
scheduled workflows as best-effort, and on this repo they were not running
every 15 minutes: measured gaps between actual runs were 1h50m and 2h46m for
reminders, and 2h31m for sync-drain. A reminder whose lead time is 30
minutes before a workout was, in practice, usually skipped rather than
sent late (the dispatch endpoint intentionally never fires once a workout's
start time has passed, so a late run does not send a stale reminder, it
just sends nothing).

Cloudflare Workers cron triggers run on time and support minute-level
granularity, so both endpoints move here.

## What it does

Every 5 minutes, `src/index.ts` sends:

```
GET https://kadenz-tau.vercel.app/api/cron/reminders
GET https://kadenz-tau.vercel.app/api/cron/sync-drain
```

both with `Authorization: Bearer <CRON_SECRET>`. A non-2xx response throws,
which Cloudflare records as a failed run (visible in the dashboard, and
wireable to email/webhook alerting later). Nothing is swallowed.

5 minutes was chosen because that is comfortably inside reminder lead-time
windows, and at 2 requests per run this is 576 requests/day, a small
fraction of Cloudflare's free-tier 100,000 requests/day.

Both target endpoints are safe to call this often, and safe to call from
here while the old GitHub Actions workflows are still enabled: reminder
dispatch claims each workout via a DB constraint before sending (a repeat
call is a no-op), and sync-drain is a no-op once the outbox is empty.

## Deploy (Jonas needs to do this)

Reminders and sync-drain keep relying on the unreliable GitHub schedule
until this Worker is deployed. From `cron-worker/`:

```bash
npm install
npx wrangler login                    # opens a browser, authorizes this machine
npx wrangler secret put CRON_SECRET   # paste the same value used for the
                                       # Vercel env var and the GitHub Actions
                                       # secret of the same name
npx wrangler deploy
```

## Confirming it is firing

```bash
npx wrangler tail
```

leave this running and wait for the next 5-minute mark, or trigger a run by
hand from the Cloudflare dashboard (Workers & Pages → kadenz-cron →
Triggers → Cron Triggers → "Trigger" next to the schedule). You should see
two log lines like `/api/cron/reminders -> 200: {...}` and
`/api/cron/sync-drain -> 200: {...}`. The dashboard's Cron Triggers tab
also shows last-run status and history without needing `tail`.

## The GitHub Actions workflows

`.github/workflows/reminders.yml` and `.github/workflows/sync-drain.yml`
were reduced from `*/15 * * * *` to `0 * * * *` (hourly) rather than
deleted. They are not the primary path anymore, but keeping a low-frequency
backstop is free and both endpoints are idempotent, so overlap with this
Worker costs nothing beyond a handful of extra requests per day. It hedges
the period between now and whenever `wrangler deploy` actually runs, and
against this Worker itself going stale (secret rotated only on one side,
Cloudflare account issue) without anyone noticing right away. If this
Worker proves reliable over a few weeks, the two workflow files can be
deleted outright.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in CRON_SECRET, .dev.vars is gitignored
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```
