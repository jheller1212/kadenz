# Neon -> Supabase cutover

Supabase project: ref `hcueeifrvfqfihdaqatz`, name Kadenz, region eu-west-1,
Postgres 17, org `tytsahyutihkmofyimcz`, free plan.

This document is the runbook. The scripts it calls live in
`scripts/supabase-migration/`. Read the header comment in each script before
running it — the reasoning for each non-obvious step lives there, not
repeated here.

## What was verified before this was written

- The full migration chain (`drizzle/0000` through `drizzle/0068`, 66 files,
  339 statements) applies cleanly to an empty Postgres, connected as a
  **non-superuser role that owns the schema it creates** — the same shape as
  the app's real connection on Neon and Supabase alike. Proven locally with
  `scripts/supabase-migration/local-rehearsal.mjs` (embedded Postgres 18.4;
  see the caveat below) and `verify-fresh-chain.mjs`.
- `FORCE ROW LEVEL SECURITY` is set on all 23 tenanted tables after that run,
  the connecting role has neither `SUPERUSER` nor `BYPASSRLS`, `SET LOCAL
  app.user_id` via `set_config(..., true)` survives inside an explicit
  transaction and does not leak past `COMMIT`, and a real two-user isolation
  check (insert as user A, read as user B, read with no context at all)
  passed. Proven locally with `verify-rls.mjs`.
- **Not yet verified against the real Supabase project.** I have no
  credentials for it and did not go looking for any (per the hard rules on
  this task). Someone with the Supabase connection string has to run
  `verify-fresh-chain.mjs` then `verify-rls.mjs` against
  `hcueeifrvfqfihdaqatz` before this cutover happens for real. That is step 1
  below, not optional.
- **Version caveat:** the local rehearsal ran on Postgres 18.4 (whatever
  `embedded-postgres` bundles), not 17.x like the real Supabase project.
  `FORCE ROW LEVEL SECURITY` and `set_config(..., true)` semantics have not
  changed between 17 and 18, so this is a low-risk gap, but it is a real one
  and is why step 1 is mandatory rather than "trust the rehearsal."
- No sequences exist anywhere in this schema — every primary key is `uuid`
  with a `gen_random_uuid()` default. The task brief's "handle sequences"
  instruction has no work item behind it here; noted so nobody goes looking
  for one.

## Step 1 — verify the chain and RLS on the real Supabase project

Use the **direct** connection (port 5432) for both of these — they run DDL
and want a stable session, not the transaction pooler.

```bash
cd web
DATABASE_URL="postgres://postgres:<password>@db.hcueeifrvfqfihdaqatz.supabase.co:5432/postgres" \
  node scripts/supabase-migration/verify-fresh-chain.mjs

DATABASE_URL="postgres://postgres:<password>@db.hcueeifrvfqfihdaqatz.supabase.co:5432/postgres" \
  node scripts/supabase-migration/verify-rls.mjs
```

`verify-fresh-chain.mjs` refuses to run against a database that already has
tables in `public`, so this is naturally a one-shot proof against a genuinely
empty project. If either script fails, stop — do not proceed to step 2 with a
half-applied or unenforced schema.

If Supabase's `postgres` role turns out to have `SUPERUSER` or `BYPASSRLS`
(check #1 in `verify-rls.mjs`), **that is the blocker this whole task exists
to catch**: `FORCE ROW LEVEL SECURITY` does nothing for a role with either
attribute, and Kadenz's entire multi-user isolation model depends on it
mattering. Do not cut over if that check fails. Supabase's documented default
is that the connection role is *not* a full Postgres superuser (`postgres` on
Supabase is close to but deliberately short of superuser, precisely so RLS
and other owner-relevant behaviour work as expected) — but "documented" is
not "verified for this project," which is why the check exists.

## Step 2 — dump Neon, restore to Supabase, verify counts

```bash
cd web

# Read-only against Neon.
NEON_DATABASE_URL="<existing production Neon URL>" \
  ./scripts/supabase-migration/dump-neon.sh neon-data.dump

# Direct connection to Supabase — see restore-supabase.sh for why not pooled.
SUPABASE_DATABASE_URL="postgres://postgres:<password>@db.hcueeifrvfqfihdaqatz.supabase.co:5432/postgres" \
  ./scripts/supabase-migration/restore-supabase.sh neon-data.dump

NEON_DATABASE_URL="<existing production Neon URL>" \
  SUPABASE_DATABASE_URL="postgres://postgres:<password>@db.hcueeifrvfqfihdaqatz.supabase.co:5432/postgres" \
  node scripts/supabase-migration/verify-row-counts.mjs

# neon-data.dump contains real training data. Delete it once row counts match.
rm neon-data.dump
```

`verify-row-counts.mjs` exits non-zero on any mismatch. Treat that as a hard
stop, not a warning to note and move past — a restore that silently drops
rows is the one failure mode this whole step exists to catch, and the app
will not tell you afterward; it will just show one user less history than
they had yesterday.

This can be rehearsed as many times as needed before the real cutover: dump
Neon, restore into the Supabase project, check counts, and if anything looks
wrong, `TRUNCATE` the affected tables on Supabase (they hold nothing real yet)
and try again. Nothing here is destructive to Neon — `dump-neon.sh` never
writes to it.

## Step 3 — the actual cutover

Do this during low-traffic hours; the app will 500 on every DB-touching route
for the seconds it takes Vercel to redeploy with the new env var, and
`/api/cron/*` runs will fail loudly (see cron-worker's README — it re-throws
on any endpoint failure, which shows up as a failed Cloudflare Worker run).

1. Re-run Step 2 (dump/restore/verify) one final time immediately before this,
   so the data on Supabase reflects the latest state, not a rehearsal from
   earlier in the day.
2. In Vercel (kadenz project), set `DATABASE_URL` to the Supabase **pooled**
   connection string — port 6543, transaction mode (Supavisor). This is what
   `src/db/index.ts` and `src/db/with-user.ts` are built for: `max: 1`,
   `prepare: false`, and an explicit `db.transaction()` wrapping every
   `SET LOCAL app.user_id`, which is exactly the shape transaction-mode
   pooling requires (one physical connection per transaction, held only for
   its duration). `prepare: false` is already set in `src/db/index.ts` and is
   necessary for this — Supavisor's transaction mode does not support
   server-side prepared statements across pooled connections, and this app
   already avoids them.
3. `scripts/migrate.mjs` (the build-step migration runner) reads the same
   `DATABASE_URL`. It issues every statement via `sql.unsafe()` with no bound
   parameters, which postgres.js does not prepare by default, and never wraps
   more than one statement in an explicit transaction — both are exactly what
   the transaction pooler tolerates. So the same pooled URL should work for
   build-time migrations too, and does not strictly need a second env var.
   That said, this was reasoned from the code, not verified against
   Supabase's actual Supavisor — if step 1's `verify-fresh-chain.mjs` run
   above was against the **direct** connection (as instructed), it has not
   actually exercised the pooler for DDL. If you want zero doubt here, either
   re-run `verify-fresh-chain.mjs` once more against the pooled URL on a
   dropped-and-recreated Supabase database before flipping Vercel, or set a
   second Vercel env var (e.g. `MIGRATE_DATABASE_URL`, direct connection) and
   point `scripts/migrate.mjs` at it with a fallback to `DATABASE_URL` — a
   small code change, not made here because it touches production build
   behaviour and wasn't asked for.
4. Neither the Garmin worker (Fly) nor the cron Cloudflare Worker talks to the
   database directly — confirmed by reading both. The Garmin worker only
   holds `GARMIN_EMAIL` / `GARMIN_PASSWORD` / `WORKER_TOKEN` and is called
   over HTTP by the Next.js app; the cron worker only holds `CRON_SECRET` /
   `APP_BASE_URL` and calls `/api/cron/*` over HTTP. **Nothing to change on
   either of them.**
5. Redeploy (push to `main` — Vercel auto-deploys, and the build step re-runs
   `scripts/migrate.mjs`, which will find the schema already fully migrated
   and apply nothing, harmlessly).

## Verifying it worked

- Load the app as the real owner account. Today's plan, activity history and
  strength sessions should all be present and match what was on Neon.
- `SELECT relforcerowsecurity FROM pg_class WHERE relname = 'plans';` (or any
  tenanted table) against the Supabase project should read `true`. This is
  the one thing to re-check after cutover specifically, not just before it —
  it is inspecting the live database the app is now actually using.
- Trigger `/api/cron/reminders` and `/api/cron/sync-drain` once manually
  (same auth header the Cloudflare Worker uses) and confirm both run to
  completion against Supabase. These are the two routes that fan out over
  every user via `forEachUser()` (`src/db/with-user.ts`) — if RLS context
  handling is subtly different on Supabase, a scoped-per-user job is where it
  would show up first, not a single-user page load.
- Watch Vercel function logs for a few minutes after cutover for any
  `relation does not exist` / `permission denied` / RLS-shaped errors.

## Rollback

Point `DATABASE_URL` in Vercel back at the Neon pooled connection string and
redeploy. Neon was never written to, dropped, or altered by any script in
this migration — every script here either reads Neon (`dump-neon.sh`) or
never touches it at all. Rollback is the env var change, nothing else.

The one thing rollback does NOT undo: any writes the app made against
Supabase between cutover and rollback (a new activity synced from Strava, a
workout marked complete) live only on Supabase and will not appear after
rolling back to Neon. If a rollback is needed, decide before doing it whether
those writes are worth manually replaying, or accept the small gap. This is
the same risk any live cutover has and is not specific to this migration.

## Size

Supabase free tier caps the database at 500 MB. I do not have Neon
credentials and did not seek any, so I have no real number — the estimate
below is exactly that, an estimate, and
`scripts/supabase-migration/measure-size.sql` is there to replace it with the
real figure the moment someone with Neon access runs it.

The named risk (per the task brief) is `activities.streams_json`,
`activities.splits_json`, `activities.laps_json` and `activities.polyline` —
confirmed in `drizzle/0000_cloudy_vapor.sql` and `drizzle/0041_activity_detail_cache.sql`.
These are `jsonb`/`text` with no size cap, one set per activity, and they are
the only unbounded-per-row columns in the schema; everything else is bounded
scalars, short text, or small fixed-shape JSON (e.g. `blocks`).

Rough order of magnitude, reasoned rather than measured: a Strava/Garmin
activity's full stream data (per-second HR/pace/elevation for a run of
30-90 minutes) as JSON commonly lands in the 20-150 KB range per activity;
splits and laps are much smaller (a few KB); a polyline is typically under
2 KB. For a single active user with a few years of running history (order of
500-1500 activities), that puts `activities` alone in the tens of MB to
low hundreds of MB range, plausibly 50-300 MB depending on how much of that
history has `streams_json` populated (it was backfilled retroactively per
`drizzle/0041`, so older activities may not all have it). Every other table
in this schema (plans, weeks, workouts, blocks, strength data, wellness
metrics) is small, bounded-per-row data and is very unlikely to add more than
a few MB even at years of history.

**Bottom line: for the current single-owner beta this is very likely under
the 500 MB free-tier cap, but activities is the table to watch as either
training history or the user count grows, and it is the one table where "it
fit last quarter" is not a reason to assume it fits next quarter.** Run
`measure-size.sql` against Neon for the real number before treating this as
settled, and re-run it periodically after cutover — Supabase will simply
start rejecting writes at the cap, which is a much worse way to find out.

## Recommendation

No blocker found. The migration chain applies cleanly and idempotently to an
empty database when run in full (0000 included — `scripts/migrate.mjs` alone
is NOT sufficient for a fresh bring-up, see the note below), RLS enforcement
mechanics check out locally against a non-superuser owning role, neither
non-Vercel service needs any change, and there are no sequences to reconcile.
The two open items before flipping the switch for real are procedural, not
structural: run step 1 against the live Supabase project (I could not), and
decide how `scripts/migrate.mjs` reaches Supabase (pooled vs a second direct
URL) per the note in step 3.

### The one thing worth fixing in `scripts/migrate.mjs` regardless of this move

`scripts/migrate.mjs` filters to files numbered `0002` and above, on the
reasoning that Neon was bootstrapped via `drizzle-kit push` and never needed
`0000`/`0001` replayed. That reasoning does not hold for a database that was
never pushed to directly — which is exactly what a fresh Supabase project is.
Running `npm run build` (and therefore `scripts/migrate.mjs`) against an
empty Supabase database, unmodified, would skip `0000_cloudy_vapor.sql` and
`0001_schema_drift_fixes.sql` and then fail on `0002` referencing tables that
were never created — loudly, not silently, so it would not ship a broken
cutover, but it would make the very first deploy against Supabase fail in a
confusing way if someone reaches for `npm run build` instead of
`verify-fresh-chain.mjs` to bring the schema up. This is why step 1 above
uses `verify-fresh-chain.mjs` (which applies the full chain, 0000 included)
rather than `scripts/migrate.mjs` for the initial bring-up. Not changed here
since it is Neon-facing production code and this task's job was to prepare
the cutover, not edit the build step — flagging it for whoever does the
actual cutover to decide: either bring the schema up once with
`verify-fresh-chain.mjs` before ever pointing Vercel at Supabase (this
runbook's approach), or adjust the file-number filter.
