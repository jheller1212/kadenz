import { NextRequest } from "next/server";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, strengthExercises, strengthSessions, strengthSets } from "@/db";
import { getVerifiedProfileId } from "@/lib/profiles";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";
import { getProgramWeekAndPhase } from "@/lib/strength/service";
import { phaseIntensityRepRangeFor } from "@/lib/strength/phase-policy";
import { EXERCISE_BY_SLUG } from "@/lib/strength/program";

// ── GET /api/strength/exercises ───────────────────────────────────────────────
// The seeded exercise catalogue, enriched with the athlete's last-used weight
// and rep range (from the most recent session containing each exercise) so
// pickers can prefill real numbers instead of catalogue defaults.
//
// strengthExercises itself is a global, shared catalogue (seeded once, no
// owner column) — it is never scoped to a caller. Only the set-history join
// below, which is real athlete data, needs ownership.
//
// `date` (optional query param, the session the picker was opened from) makes
// the catalogue's own `repLow`/`repHigh` phase-aware for the curated
// PHASE_INTENSITY_COMPOUND_SLUGS patterns (see phase-policy.ts
// phaseIntensityRepRangeFor) — resolved here, server-side, off the SAME
// running-plan week the rest of that session's plan was built from
// (buildSessionPlan / session.ts), rather than the client re-deriving the
// phase rule (it doesn't have the week data to do so, and doing it there
// would be a second implementation of the rule — see docs/DUPLICATION.md).
// `lastRepLow`/`lastRepHigh` (below, from the athlete's own logged history)
// are untouched: that's what they actually did, not a catalogue default.
// Without `date`, `repLow`/`repHigh` stay exactly the static catalogue
// values, same as before this existed (used by e.g. the frequency-sort path,
// which never reads them).

export const GET = withSession(async (request: NextRequest) => {
  const profileId = await getVerifiedProfileId(request);
  try {
    const dateParam = request.nextUrl.searchParams.get("date");
    const weekInfo = dateParam
      ? (await getProgramWeekAndPhase(new Date(dateParam))).weekInfo
      : null;
    // The catalogue and the athlete's set history are independent lookups —
    // run them together instead of two serialised round trips.
    const [rows, sets] = await Promise.all([
      db
        .select()
        .from(strengthExercises)
        .orderBy(asc(strengthExercises.sortOrder)),

      // Newest-first logged sets; reduce to each exercise's latest session.
      db
        .select({
          exerciseId: strengthSets.exerciseId,
          sessionId: strengthSets.sessionId,
          date: strengthSessions.date,
          weightKg: strengthSets.weightKg,
          reps: strengthSets.reps,
        })
        .from(strengthSets)
        .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
        .where(
          and(
            ownedBy(strengthSessions),
            isNotNull(strengthSets.reps),
            profileId
              ? eq(strengthSessions.profileId, profileId)
              : isNull(strengthSessions.profileId)
          )
        )
        .orderBy(desc(strengthSets.createdAt)),
    ]);

    const latest = new Map<
      string,
      { sessionId: string; date: Date; weightKg: number | null; repLow: number; repHigh: number }
    >();
    // Distinct sessions each exercise appeared in — powers "sort by frequency".
    const sessionsPerExercise = new Map<string, Set<string>>();
    for (const s of sets) {
      let seen = sessionsPerExercise.get(s.exerciseId);
      if (!seen) {
        seen = new Set();
        sessionsPerExercise.set(s.exerciseId, seen);
      }
      seen.add(s.sessionId);
      const cur = latest.get(s.exerciseId);
      if (!cur) {
        latest.set(s.exerciseId, {
          sessionId: s.sessionId,
          date: new Date(s.date),
          weightKg: s.weightKg,
          repLow: s.reps!,
          repHigh: s.reps!,
        });
      } else if (cur.sessionId === s.sessionId) {
        // Same (latest) session: widen the rep range, keep the heaviest load.
        cur.repLow = Math.min(cur.repLow, s.reps!);
        cur.repHigh = Math.max(cur.repHigh, s.reps!);
        if (s.weightKg != null && (cur.weightKg == null || s.weightKg > cur.weightKg)) {
          cur.weightKg = s.weightKg;
        }
      }
    }

    return Response.json(
      rows.map((r) => {
        const l = latest.get(r.id);
        // Same guard as the main plan (see the module comment above): only
        // the curated compound patterns, only with a startWeightKg, only
        // when there's an active running plan's week to resolve against —
        // otherwise the catalogue's own static repLow/repHigh pass through
        // unchanged.
        const phaseRange = weekInfo
          ? phaseIntensityRepRangeFor(
              r.slug,
              r.startWeightKg,
              EXERCISE_BY_SLUG[r.slug]?.achillesRole,
              weekInfo
            )
          : null;
        return {
          ...r,
          repLow: phaseRange?.repLow ?? r.repLow,
          repHigh: phaseRange?.repHigh ?? r.repHigh,
          lastWeightKg: l?.weightKg ?? null,
          lastRepLow: l?.repLow ?? null,
          lastRepHigh: l?.repHigh ?? null,
          lastDate: l?.date.toISOString() ?? null,
          timesPerformed: sessionsPerExercise.get(r.id)?.size ?? 0,
        };
      })
    );
  } catch (err) {
    console.error("DB error listing strength exercises:", err);
    return Response.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
});
