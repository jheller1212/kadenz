// ── Personal-record detection ────────────────────────────────────────────────
//
// A PR is scoped to a single exercise, and there are three independent
// records because they answer different questions — an athlete can set one
// without the others:
//   - heaviest working set: the hardest single set ever done. Weight is the
//     primary key; at equal weight, more reps is still a real improvement, so
//     reps is the tiebreak.
//   - best estimated one-rep max (e1rm): the best SINGLE-SET projection of
//     what the athlete could lift for one rep, via the Epley formula
//     (w * (1 + reps / 30)). Epley, not Brzycki: Brzycki assumes low rep
//     counts and goes non-monotonic (then negative) as reps approach 36,
//     while Kadenz's high-rep accessory ranges (up to 25, see program.ts
//     repHigh) and bodyweight AMRAP sets routinely land in that zone. Epley
//     degrades gracefully instead.
//   - best session volume: total load moved across every working set of the
//     exercise in one session — a whole-session measure, not a single-set one.
//
// Bodyweight exercises (catalogue startWeightKg is unset; every logged set
// has weightKg null/0) have no meaningful "heaviest" or e1rm — the only lever
// is reps. For those, the heaviest-set and e1rm records both collapse to
// "most reps in one set", and the volume record becomes "most total reps in
// one session".
//
// Per-hand / two-dumbbell lifts (ExerciseDef.dumbbells) store weightKg as the
// load PER DUMBBELL — the same convention weights.ts's formatLoad uses
// everywhere else in the app. A two-dumbbell lift moves roughly double that
// per rep, so session volume is scaled by the dumbbell count to report a true
// total-kg-moved figure. Heaviest-set and e1rm are left as the per-hand
// number, because that's the number the athlete reads off the dumbbell and
// the number progression.ts already reasons about. The dumbbell count is
// fixed per exercise (it never changes session to session), so this scaling
// only affects the displayed volume figure — it never changes which session
// ranks as the record.
//
// Warm-up sets must never win a record. `PrSet.setType` is optional because
// the schema doesn't tag set types yet (see strength_sets.feel, which is a
// different, unrelated field) — every caller today omits it, and an absent
// setType is treated as a working set so nothing regresses. Once a warm-up
// tag lands, threading it through into `setType` here is the only change
// needed; the exclusion logic already exists.

export type PrSetType = "warmup" | "working" | "failure" | "dropset";

export interface PrSet {
  weightKg: number | null;
  reps: number | null;
  /** Absent/undefined = working set (see module note above). */
  setType?: PrSetType | null;
}

export interface ExerciseLoadProfile {
  /** True when the exercise has no external load (catalogue startWeightKg is
   *  unset). Every record then falls back to a reps-only measure. */
  bodyweight: boolean;
  /** Dumbbells this lift uses; only relevant when not bodyweight. Missing =
   *  standard two-dumbbell pair, matching weights.ts's default. */
  dumbbells?: 1 | 2 | null;
}

function isWorkingSet(s: PrSet): boolean {
  return s.setType == null || s.setType !== "warmup";
}

/** Epley estimated 1RM. Returns 0 for a non-positive weight or rep count. */
export function e1rm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export interface SingleSetBest {
  /** 0 for bodyweight exercises — reps is the record there instead. */
  topWeightKg: number;
  /** Reps at the heaviest set (the tiebreak weight), or best reps in a set
   *  for a bodyweight exercise. */
  topWeightReps: number;
  /** Best single-set Epley estimate; for bodyweight, equals topWeightReps —
   *  there is no weight to project a 1RM from, so "most reps in a set" is
   *  the closest analogue and keeps the field meaningful for the UI. */
  bestE1rm: number;
}

/** Fold a flat list of sets (any mix of sessions) into single-set bests. */
function foldSingleSetBest(sets: PrSet[], profile: ExerciseLoadProfile): SingleSetBest {
  let topWeightKg = 0;
  let topWeightReps = 0;
  let bestE1rm = 0;

  for (const s of sets) {
    if (!isWorkingSet(s)) continue;
    const reps = s.reps ?? 0;
    if (profile.bodyweight) {
      if (reps > topWeightReps) topWeightReps = reps;
      bestE1rm = Math.max(bestE1rm, reps);
      continue;
    }
    const weightKg = s.weightKg ?? 0;
    if (weightKg > topWeightKg || (weightKg === topWeightKg && reps > topWeightReps)) {
      topWeightKg = weightKg;
      topWeightReps = reps;
    }
    bestE1rm = Math.max(bestE1rm, e1rm(weightKg, reps));
  }

  return { topWeightKg, topWeightReps, bestE1rm };
}

export interface SessionMetrics extends SingleSetBest {
  sessionId: string;
  date: Date;
  /** Total load moved this session: sum(weight * reps), scaled by dumbbell
   *  count for loaded exercises; total reps for bodyweight ones. */
  volume: number;
}

/**
 * One set's contribution to session volume: kg × reps, doubled for a
 * two-dumbbell lift (weightKg is stored PER DUMBBELL — see module note
 * above), or bare reps for a bodyweight exercise (there's no external load
 * to multiply, so reps is the closest volume analogue). This is the single
 * place that formula lives — session-detail, the Kraft hub, and exercise
 * history all reach it via lib/strength/volume.ts's sessionVolume(), so a
 * set is never worth two different numbers on two screens.
 */
export function setVolumeKg(
  set: Pick<PrSet, "weightKg" | "reps">,
  profile: ExerciseLoadProfile
): number {
  const reps = set.reps ?? 0;
  if (profile.bodyweight) return reps;
  const dumbbellMultiplier = profile.dumbbells === 1 ? 1 : 2;
  return (set.weightKg ?? 0) * reps * dumbbellMultiplier;
}

/** Aggregate one session's sets into its PR-relevant metrics. */
export function computeSessionMetrics(
  sets: PrSet[],
  sessionId: string,
  date: Date,
  profile: ExerciseLoadProfile
): SessionMetrics {
  const best = foldSingleSetBest(sets, profile);

  let volume = 0;
  for (const s of sets) {
    if (!isWorkingSet(s)) continue;
    volume += setVolumeKg(s, profile);
  }

  return { sessionId, date, volume, ...best };
}

export interface PrFlags {
  weight: boolean;
  e1rm: boolean;
  volume: boolean;
}

export interface SessionWithPr extends SessionMetrics {
  pr: PrFlags;
}

/**
 * Walk sessions oldest-first and flag which ones set a new record at the
 * time — strictly greater than everything before it, never a tie, and never
 * a zero (an exercise with no logged working sets that session sets nothing).
 */
export function annotatePrs(sessions: SessionMetrics[]): SessionWithPr[] {
  let bestWeight = 0;
  let bestE1rmSoFar = 0;
  let bestVolume = 0;

  return sessions.map((s) => {
    const weight = s.topWeightKg > 0 && s.topWeightKg > bestWeight;
    const e1rmPr = s.bestE1rm > 0 && s.bestE1rm > bestE1rmSoFar;
    const volume = s.volume > 0 && s.volume > bestVolume;
    bestWeight = Math.max(bestWeight, s.topWeightKg);
    bestE1rmSoFar = Math.max(bestE1rmSoFar, s.bestE1rm);
    bestVolume = Math.max(bestVolume, s.volume);
    return { ...s, pr: { weight, e1rm: e1rmPr, volume } };
  });
}

export interface CurrentRecords {
  topWeightKg: number;
  topWeightReps: number;
  topWeightDate: Date | null;
  bestE1rm: number;
  bestE1rmDate: Date | null;
  bestVolume: number;
  bestVolumeDate: Date | null;
}

/** The best-to-date snapshot across a chronological (oldest-first) session list. */
export function currentRecords(sessions: SessionMetrics[]): CurrentRecords {
  const records: CurrentRecords = {
    topWeightKg: 0,
    topWeightReps: 0,
    topWeightDate: null,
    bestE1rm: 0,
    bestE1rmDate: null,
    bestVolume: 0,
    bestVolumeDate: null,
  };
  for (const s of sessions) {
    if (s.topWeightKg > records.topWeightKg) {
      records.topWeightKg = s.topWeightKg;
      records.topWeightReps = s.topWeightReps;
      records.topWeightDate = s.date;
    }
    if (s.bestE1rm > records.bestE1rm) {
      records.bestE1rm = s.bestE1rm;
      records.bestE1rmDate = s.date;
    }
    if (s.volume > records.bestVolume) {
      records.bestVolume = s.volume;
      records.bestVolumeDate = s.date;
    }
  }
  return records;
}

/**
 * Whether one just-logged set beats the athlete's all-time best for this
 * exercise (from completed prior sessions only — the caller excludes the
 * in-progress session). Used for the live "new PR" moment in a guided
 * session; volume PRs are whole-session and are surfaced on the history page
 * instead, not per set.
 */
export function isNewSingleSetRecord(
  set: PrSet,
  priorSets: PrSet[],
  profile: ExerciseLoadProfile
): { weight: boolean; e1rm: boolean } {
  if (!isWorkingSet(set)) return { weight: false, e1rm: false };
  const prior = foldSingleSetBest(priorSets, profile);
  const reps = set.reps ?? 0;

  if (profile.bodyweight) {
    const isPr = reps > prior.topWeightReps && reps > 0;
    return { weight: isPr, e1rm: isPr };
  }

  const weightKg = set.weightKg ?? 0;
  const weight =
    weightKg > 0 &&
    (weightKg > prior.topWeightKg || (weightKg === prior.topWeightKg && reps > prior.topWeightReps));
  const thisE1rm = e1rm(weightKg, reps);
  const e1rmPr = thisE1rm > 0 && thisE1rm > prior.bestE1rm;
  return { weight, e1rm: e1rmPr };
}
