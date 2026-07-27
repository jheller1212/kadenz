import { NextRequest } from "next/server";
import { db, plans, activities, strengthSessions, strengthSets } from "@/db";
import { and, eq, desc, gte, isNull, inArray, lte, or } from "drizzle-orm";
import { getActiveProfileId } from "@/lib/profiles";
import { isPastDuePlanned, sortSessionsByDateDesc } from "@/lib/training/session";

// The feed's default rolling window. The client (activities/page.tsx) always
// sends explicit `from`/`to` query params — this is only the fallback for a
// caller that omits them, so the route never silently reads the whole table.
// Keep in sync with DEFAULT_WINDOW_MONTHS in activities/page.tsx.
const DEFAULT_WINDOW_MONTHS = 12;

function defaultFrom(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - DEFAULT_WINDOW_MONTHS);
  return d;
}

// Strava-shaped split row, as stored raw in activities.splitsJson (see
// parseSplits() in api/activities/[id]/route.ts — same source, same shape).
interface RawSplit {
  split: number;
  average_speed: number;
}

/**
 * Reduce a full splitsJson blob down to just per-km paces for the feed's
 * inline mini chart. The list route intentionally never selects splitsJson
 * itself (it can be a large per-activity blob) — this is fetched in one
 * batched, id-scoped query and discarded immediately after compaction, so
 * only a short number array per activity ever reaches the response.
 */
function splitPacesFromJson(raw: unknown, max = 12): number[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const paces = (raw as RawSplit[])
    .map((s) => (s.average_speed > 0 ? Math.round(1000 / s.average_speed) : 0))
    .filter((p) => p > 0);
  return paces.length >= 2 ? paces.slice(0, max) : null;
}

export async function GET(request: NextRequest) {
  const profileId = getActiveProfileId(request);
  const { searchParams } = new URL(request.url);
  // Client-controlled window (activities/page.tsx always sends both; see
  // DEFAULT_WINDOW_MONTHS above for the fallback when it doesn't). Selecting
  // an older year re-requests with that year's from/to — it is never a
  // client-side filter over a truncated list, which is what would silently
  // break once this route stopped returning full history.
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const windowFrom = fromParam ? new Date(fromParam) : defaultFrom();
  const windowTo = toParam ? new Date(toParam) : null;

  try {
    // Every table below is scoped to [windowFrom, windowTo]. Activities and
    // strength sessions are independent of each other, so fetch them (and
    // the active plan) together instead of serialising three round-trips
    // over the single DB connection (postgres({ max: 1 }) in src/db/index.ts).
    const [allActivities, [activePlan], strengthRows] = await Promise.all([
      // 1. Strava activities in the window. Strava is the owner's device —
      //    guest profiles see only their own in-app sessions.
      profileId
        ? Promise.resolve([])
        : db
            // Only what the list renders. `select()` also pulled splitsJson,
            // lapsJson, polyline and aiInsight — megabytes of per-activity JSON
            // that nothing here reads (the detail route fetches those).
            .select({
              id: activities.id,
              stravaId: activities.stravaId,
              garminId: activities.garminId,
              sportType: activities.sportType,
              name: activities.name,
              startDate: activities.startDate,
              distanceKm: activities.distanceKm,
              durationSeconds: activities.durationSeconds,
              avgPaceSecKm: activities.avgPaceSecKm,
              avgHr: activities.avgHr,
              maxHr: activities.maxHr,
              elevationGain: activities.elevationGain,
              workoutId: activities.workoutId,
              strengthSessionId: activities.strengthSessionId,
              createdAt: activities.createdAt,
            })
            .from(activities)
            // startDate is null for a handful of legacy/manual rows, which is
            // also why the list orders by createdAt as a tiebreak — fall back
            // to createdAt for the window check on exactly those rows too, so
            // they don't silently disappear from every window.
            .where(
              or(
                and(
                  gte(activities.startDate, windowFrom),
                  windowTo ? lte(activities.startDate, windowTo) : undefined
                ),
                and(
                  isNull(activities.startDate),
                  gte(activities.createdAt, windowFrom),
                  windowTo ? lte(activities.createdAt, windowTo) : undefined
                )
              )
            )
            .orderBy(desc(activities.startDate), desc(activities.createdAt)),

      // Active plan, for linking workout details.
      db
        .select({ id: plans.id, name: plans.name })
        .from(plans)
        .where(eq(plans.status, "active"))
        .limit(1),

      // 5. Strength sessions in the same window — unified feed + enrichment.
      db
        .select()
        .from(strengthSessions)
        .where(
          and(
            profileId
              ? eq(strengthSessions.profileId, profileId)
              : isNull(strengthSessions.profileId),
            gte(strengthSessions.date, windowFrom),
            windowTo ? lte(strengthSessions.date, windowTo) : undefined
          )
        ),
    ]);

    // For activities linked to workouts, fetch workout details; planned
    // (missed) workouts on the active plan; and this window's strength sets.
    // These three depend on the results above but not on each other.
    const linkedWorkoutIds = allActivities
      .filter((a) => a.workoutId)
      .map((a) => a.workoutId!);

    const [linkedWorkouts, planned, allSets] = await Promise.all([
      linkedWorkoutIds.length > 0
        ? db.query.workouts.findMany({
            where: (wo, { inArray }) => inArray(wo.id, linkedWorkoutIds),
            with: {
              blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] },
            },
          })
        : Promise.resolve([]),

      activePlan
        ? db.query.workouts.findMany({
            where: (wo, { and, eq }) =>
              and(eq(wo.planId, activePlan.id), eq(wo.status, "planned")),
            orderBy: (wo, { desc }) => [desc(wo.date)],
            with: {
              blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] },
            },
          })
        : Promise.resolve([]),

      // All logged sets for this window's sessions, batched once — feeds both
      // the "has any logged sets" check below and the feed's per-session
      // tonnage mini chart (real weight × reps per set, never invented numbers).
      strengthRows.length > 0
        ? db
            .select({
              sessionId: strengthSets.sessionId,
              weightKg: strengthSets.weightKg,
              reps: strengthSets.reps,
              kind: strengthSets.kind,
              createdAt: strengthSets.createdAt,
            })
            .from(strengthSets)
            .where(
              inArray(
                strengthSets.sessionId,
                strengthRows.map((s) => s.id)
              )
            )
        : Promise.resolve([]),
    ]);

    const workoutMap = new Map<
      string,
      { type: string; title: string; blocks: unknown[] }
    >();
    for (const wo of linkedWorkouts) {
      workoutMap.set(wo.id, {
        type: wo.type,
        title: wo.title,
        blocks: wo.blocks,
      });
    }

    // Only include planned workouts in the past (missed) — not future ones
    const now = new Date();
    const plannedWorkouts = planned
      .filter((wo) => isPastDuePlanned(wo, now) && wo.type !== "rest")
      .map((wo) => ({
        id: wo.id,
        type: wo.type,
        title: wo.title,
        date: wo.date,
        status: wo.status,
        targetKm: wo.targetKm,
        targetDurationMinutes: wo.targetDurationMinutes,
        blocks: wo.blocks,
      }));

    const sessionMap = new Map(strengthRows.map((s) => [s.id, s]));

    // Which sessions actually logged at least one set (reps recorded). Sessions
    // with zero logged sets are treated as never-really-done and kept out of the
    // standalone strength feed below.
    const sessionsWithSets = new Set(
      allSets.filter((s) => s.reps != null).map((s) => s.sessionId)
    );

    /** Chronological working-set tonnage (weight × reps) for one session's
     * mini chart. Warm-ups and bodyweight-only sets (no weight logged) are
     * excluded so bars stay a consistent, honest unit — a session that never
     * logged weight gets no chart rather than a misleading one. */
    function sessionVolumeBars(sessionId: string, max = 10): number[] | null {
      const bars = allSets
        .filter((s) => s.sessionId === sessionId && s.kind !== "warmup" && s.weightKg != null && s.reps != null)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((s) => Math.round(s.weightKg! * s.reps!));
      return bars.length >= 2 ? bars.slice(0, max) : null;
    }

    /** Wrap a raw values array (or null) into the feed's tagged chart shape. */
    function volumeChart(sessionId: string): { kind: "volume"; values: number[] } | null {
      const values = sessionVolumeBars(sessionId);
      return values ? { kind: "volume", values } : null;
    }

    // 5b. Splits, batched, id-scoped — only for run activities (splitsJson is
    // meaningless for a strength entry). Compacted to bare pace numbers by
    // splitPacesFromJson() before it ever touches the response; see that
    // function's comment for why this doesn't reintroduce the payload-size
    // problem the original slim select() above was written to avoid.
    const runActivityIds = allActivities
      .filter(
        (a) =>
          !a.strengthSessionId &&
          a.sportType !== "WeightTraining" &&
          a.sportType !== "Workout" &&
          a.sportType !== "Crossfit" &&
          a.sportType !== "HIIT"
      )
      .map((a) => a.id);
    const splitsRows =
      runActivityIds.length > 0
        ? await db
            .select({ id: activities.id, splitsJson: activities.splitsJson })
            .from(activities)
            .where(inArray(activities.id, runActivityIds))
        : [];
    const splitPacesMap = new Map(
      splitsRows.map((r) => [r.id, splitPacesFromJson(r.splitsJson)])
    );

    // 6. Build unified response — recorded activities first (runs + strength).
    const activityItems = allActivities.map((a) => {
      const linkedRun = a.workoutId ? workoutMap.get(a.workoutId) : null;
      const linkedSession = a.strengthSessionId ? sessionMap.get(a.strengthSessionId) : null;
      const isStrength = !!linkedSession || a.sportType === "WeightTraining" || a.sportType === "Workout" || a.sportType === "Crossfit" || a.sportType === "HIIT";
      // Inline feed mini chart: split paces for a run, set tonnage for a
      // linked strength session. Null when there's genuinely nothing to
      // chart — the card renders without one rather than an empty frame.
      const paceValues = !isStrength ? splitPacesMap.get(a.id) ?? null : null;
      const chart = isStrength
        ? a.strengthSessionId
          ? volumeChart(a.strengthSessionId)
          : null
        : paceValues
        ? { kind: "pace" as const, values: paceValues }
        : null;
      return {
        id: a.id,
        source: "strava" as const,
        kind: isStrength ? "strength" : "run",
        stravaId: a.stravaId,
        date: (a.startDate ?? a.createdAt).toISOString(),
        type: isStrength ? "strength" : linkedRun?.type ?? "run",
        strengthType: linkedSession?.type ?? null,
        title: linkedSession?.title ?? a.name ?? linkedRun?.title ?? (isStrength ? "Strength" : "Run"),
        distanceKm: a.distanceKm,
        durationSeconds: a.durationSeconds,
        avgPaceSecKm: a.avgPaceSecKm,
        avgHr: a.avgHr,
        maxHr: a.maxHr,
        elevationGain: a.elevationGain,
        status: "completed",
        workoutId: a.workoutId,
        strengthSessionId: a.strengthSessionId,
        chart,
        activity: {
          id: a.id,
          stravaId: a.stravaId,
          distanceKm: a.distanceKm,
          durationSeconds: a.durationSeconds,
          avgPaceSecKm: a.avgPaceSecKm,
          avgHr: a.avgHr,
          maxHr: a.maxHr,
        },
        blocks: linkedRun?.blocks ?? [],
      };
    });

    // 7. Strength sessions without a recorded activity → standalone feed items
    //    (completed in-app, or past-planned = missed). Future ones are skipped.
    const linkedSessionIds = new Set(
      allActivities.filter((a) => a.strengthSessionId).map((a) => a.strengthSessionId!)
    );
    // A stale planned session is a duplicate when a completed session of the
    // same type exists on the same day (the workout happened — via an ad-hoc
    // start — and the planned row was simply left behind). Hide it.
    const completedDayType = new Set(
      strengthRows
        .filter((s) => s.status === "completed")
        .map((s) => `${new Date(s.date).toDateString()}:${s.type}`)
    );
    const strengthItems = strengthRows
      .filter((s) => !linkedSessionIds.has(s.id))
      .filter((s) => s.status === "completed" || isPastDuePlanned(s, now))
      .filter(
        (s) =>
          s.status === "completed" ||
          !completedDayType.has(`${new Date(s.date).toDateString()}:${s.type}`)
      )
      // Completed sessions always show (a manual tick is a real workout);
      // otherwise require logged sets so opened-but-empty ones don't clutter.
      .filter((s) => s.status === "completed" || sessionsWithSets.has(s.id))
      .map((s) => ({
        id: `strength:${s.id}`,
        source: "session" as const,
        kind: "strength" as const,
        stravaId: null,
        date: new Date(s.date).toISOString(),
        type: "strength",
        strengthType: s.type,
        title: s.title,
        distanceKm: null,
        durationSeconds: s.durationMinutes ? s.durationMinutes * 60 : null,
        avgPaceSecKm: null,
        avgHr: null,
        maxHr: null,
        elevationGain: null,
        status: s.status,
        workoutId: null,
        strengthSessionId: s.id,
        chart: volumeChart(s.id),
        activity: null,
        blocks: [],
      }));

    const unified = sortSessionsByDateDesc([...activityItems, ...strengthItems]);

    return Response.json({
      activities: unified,
      plannedWorkouts,
      planName: activePlan?.name ?? null,
      // Echoes the window actually applied (including the server fallback
      // when the client sent no `from`), so the feed can tell the athlete
      // it's showing a range rather than letting them think older training
      // vanished.
      window: { from: windowFrom.toISOString(), to: windowTo ? windowTo.toISOString() : null },
    });
  } catch (err) {
    console.error("DB error fetching activities:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
