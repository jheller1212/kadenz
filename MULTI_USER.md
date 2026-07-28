# What "an app for many users" actually costs

Written 2026-07-28, from a read of `origin/main`. Kadenz today is a
single-athlete app with a household guest model bolted onto part of it. This
document says exactly what stands between that and a second real user, so the
decision can be made deliberately rather than discovered halfway through.

---

## 1. Where it stands today

**There is no signup.** A session cookie is minted in exactly two places, the
Strava and Google OAuth callbacks, and only after the account passes a
hardcoded allowlist (`KADENZ_ALLOWED_STRAVA_ATHLETE_IDS`,
`KADENZ_ALLOWED_GOOGLE_EMAILS`, see `web/src/lib/owner.ts`). Anyone else gets a
403. The cookie itself proves only that some browser holds a value signed with
`SESSION_SECRET`. It does not identify a person.

**The profile model is not auth, and says so.** `web/src/lib/profiles.ts`
states plainly that the active profile is a client-writable, non-httpOnly
cookie, and that this is "a single-household trust model, not auth". Anyone
who can open devtools can become any profile.

**Only four tables are profile-scoped:** `strength_sessions`, `wellness_logs`,
`strength_plan_settings`, `custom_workout_templates`.

**The entire running domain has no tenancy column at all:** `plans`, `weeks`,
`workouts`, `blocks`, `activities`, `deleted_activities`, `activity_trash`,
`personal_records`, `sync_outbox`, `wellness_metrics`, `push_subscriptions`,
`reminder_settings`, `sent_reminders`. `reminder_settings` is commented as a
"Singleton settings row (single-athlete app)".

**OAuth tokens are stored as one credential set**, not per user
(`saveTokens()` in `web/src/lib/sync/strava-client.ts` and `gcal-client.ts`).

So removing the allowlist would not open the app up. It would let a stranger
see and overwrite the owner's training plan.

---

## 2. What a second user actually requires

In dependency order. Each step is close to useless without the one before it.

1. **Real identity.** A `users` table, and a session that carries a user id
   rather than the string "authenticated". This is the change that touches
   `web/src/lib/session.ts`, `owner.ts`, and `proxy.ts`.
2. **Tenancy on every table listed above**, plus a `user_id` on the four
   already-profile-scoped tables, since a profile belongs to a user.
3. **Every query filtered by it.** This is the bulk of the work and the part
   most likely to leak data if done by hand. Roughly every route under
   `web/src/app/api/` and every helper in `web/src/lib/` that touches the
   database.
4. **Per-user OAuth tokens**, so two users can each connect their own Strava,
   Garmin and Calendar.
5. **Per-user cron.** Reminders, the sync drain and the wellness pull all
   currently assume one athlete. They become per-user loops, which changes
   their cost profile.
6. **Signup, account recovery, deletion.** Including a real GDPR delete, which
   the cascade work from the profile soft delete is a useful precedent for.

---

## 3. The honest costs

**This is not a feature, it is a re-foundation.** Step 3 alone means auditing
every data access path in the app. A missed filter is not a bug that shows up
as a broken page, it is one user seeing another user's data.

**Cost changes shape.** Today one athlete's data sits on Neon's free tier,
which already autosuspends and produces the cold start measured at 2.5s. Many
users means a paid database, per-user cron fan-out, and push volume that no
longer fits in a corner of the free tiers.

**Support and liability arrive with the second user.** Training data plus
health metrics (HRV, sleep, resting heart rate) is GDPR special-category
adjacent. A personal app that logs your own sleep is one thing. A service
holding strangers' sleep data is another, and it needs a privacy policy, a
deletion path and a breach plan.

---

## 4. The recommendation

**Do not start this incrementally in the dark.** A half-migrated tenancy model
is strictly worse than either endpoint: the queries that are filtered give a
false sense of safety while the unfiltered ones leak.

Two coherent options:

**A. Stay single-athlete, and make it excellent.** The app is genuinely good
at what it does for one person plus household guests. Everything shipped this
month (readiness from the watch, reliable reminders, Kraft generation that
adapts to equipment and injuries) has value without a second user existing.
The multi-user surface work still pays off here, because "not obviously
tailored to one person" is what makes the app feel finished.

**B. Commit to multi-user as a project**, done in the order above, with step 3
verified by a test that asserts every table with a tenancy column is filtered
on every read path, not by reviewer attention.

The work already done in that direction is real and is not wasted either way:
Kraft now generates from onboarding rather than from one athlete's injury, and
the profile model is honest about what it is.

**What this document deliberately does not do is start option B.** That is a
decision about what Kadenz is for, and it belongs to Jonas.
