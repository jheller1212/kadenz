// ── Strength module domain types ─────────────────────────────────────────────

export type StrengthCategory = "upper" | "lower" | "achilles" | "full_body";

/** Equipment an exercise needs. Absent/empty = bodyweight + floor only. */
export type Equipment =
  | "dumbbell"
  | "barbell"
  | "bench"
  | "chair"
  | "box"
  | "kettlebell"
  | "pullup_bar"
  | "band"
  | "machine";
/** Every schedulable strength session type — the one list all schemas use. */
export const STRENGTH_SESSION_TYPES = [
  "upper",
  "lower",
  "lower_achilles",
  "upper_achilles",
  "achilles",
  "full_body",
] as const;

export type StrengthSessionType = (typeof STRENGTH_SESSION_TYPES)[number];
export type PainTiming = "during" | "after" | "next_day";

// ── Reported running complaints (Kraft setup, optional step) ────────────────
// Drives which programme an athlete gets: "achilles" keeps today's dedicated
// Achilles/HSR sessions; every other complaint adds a small, well-evidenced
// block of targeted work to the ordinary lower/full_body sessions instead of
// prescribing a full rehab protocol. Empty/absent = general runner default.
export const STRENGTH_COMPLAINTS = [
  "achilles",
  "plantar_fascia",
  "shin",
  "knee",
  "itb",
  "hamstring",
  "hip_glute",
] as const;

export type Complaint = (typeof STRENGTH_COMPLAINTS)[number];

// ── Strength goal (Kraft setup wizard) ───────────────────────────────────────
// "running_focus" trims upper-body accessory volume and adds a set to
// posterior-chain/unilateral lower work (see program.ts
// RUNNING_FOCUS_POSTERIOR_CHAIN_SLUGS + session.ts buildSessionPlan);
// "all_round" leaves the template's own set counts untouched. Also drives
// which session-type mix the weekly scheduler rotates through (see
// reconcile.ts rotationFor).
export const STRENGTH_GOALS = ["running_focus", "all_round"] as const;
export type Goal = (typeof STRENGTH_GOALS)[number];

export const COMPLAINT_LABELS: Record<Complaint, string> = {
  achilles: "Achilles tendinopathy",
  plantar_fascia: "Plantar fascia pain",
  shin: "Shin pain (medial tibial stress)",
  knee: "Patellofemoral / runner's knee",
  itb: "ITB (outer knee) pain",
  hamstring: "Hamstring (proximal tendon) pain",
  hip_glute: "Hip / glute weakness or ache",
};

// Short body-area words for inline prompts ("Any Achilles / knee pain?").
export const COMPLAINT_SHORT_LABELS: Record<Complaint, string> = {
  achilles: "Achilles",
  plantar_fascia: "plantar fascia",
  shin: "shin",
  knee: "knee",
  itb: "ITB",
  hamstring: "hamstring",
  hip_glute: "hip / glute",
};

// Role within an Achilles session — drives the "explosive first, slow heavy
// after" ordering rule.
export type AchillesRole = "explosive" | "slow_heavy" | null;

/** A single exercise definition (seed catalogue + template metadata). */
export interface ExerciseDef {
  slug: string;
  name: string;
  category: StrengthCategory;
  equipmentNote?: string;
  tempoNote?: string;
  flatGroundOnly?: boolean;
  slowProgressor?: boolean;
  defaultSets?: number;
  repLow?: number;
  repHigh?: number;
  /** Suggested start load per dumbbell (kg); undefined = bodyweight to start. */
  startWeightKg?: number;
  /** Dumbbells the lift uses (1 or 2). Omit for bodyweight, or when a standard
   *  pair (2, one per hand) is implied for a dumbbell lift. */
  dumbbells?: 1 | 2;
  /** Short note on how the load is held, e.g. "opposite hand", "goblet". */
  holdNote?: string;
  /** Ordering role inside an Achilles block. */
  achillesRole?: AchillesRole;
  /** Primary muscle the lift trains — drives the custom-builder grouping. */
  primaryMuscle?: string;
  /** Secondary muscles for compound lifts. */
  secondaryMuscles?: string[];
  /** Required equipment; every item must be available. Empty = bodyweight. */
  equipment?: Equipment[];
}

/**
 * Trim priority for duration-fitting (see duration-fit.ts):
 *  - "primary": a main compound lift. Kept at every session length; only its
 *    set count flexes.
 *  - "accessory": isolation/finisher work. First to go when a session has to
 *    shrink, and never added back to fatten a longer session.
 *  - "targeted": complaint-specific work injected by a reported complaint
 *    (see program.ts TARGETED_WORK). Protected the same way Achilles-role
 *    work is — never dropped whole by duration-fitting, only its set count
 *    may flex.
 * Achilles-role exercises (see ExerciseDef.achillesRole) are NEVER
 * "accessory" regardless of this field — the tendon program is load-bearing,
 * not optional, and is protected from removal in the fitting logic itself.
 */
export type SlotPriority = "primary" | "accessory" | "targeted";

/**
 * A ranked equipment-gated alternative for a template slot. `equipment` is
 * the exact kit this variant needs — every item must be in the athlete's
 * available equipment for it to be picked. `[]` means bodyweight, always
 * satisfiable, so a slot whose variant list ends in a `[]` entry can never
 * fail to resolve. Rep/set overrides are optional — omitted fields fall
 * back to the slot's own base prescription (most variants keep the same
 * training stimulus; bodyweight floors usually need more reps to compensate
 * for the missing load).
 */
export interface SlotVariant {
  exerciseSlug: string;
  equipment: Equipment[];
  sets?: number;
  repLow?: number;
  repHigh?: number;
  perSide?: boolean;
}

/** A prescribed slot in a session template. */
export interface TemplateSlot {
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  /** Loaded per hand/leg rather than a matched pair, when relevant. */
  perSide?: boolean;
  /** Trim priority; omitted = "primary" (see SlotPriority). */
  priority?: SlotPriority;
  /**
   * Ranked equipment-gated alternatives for this slot, best first (see
   * resolveSlotVariant in program.ts). Absent = the slot always resolves to
   * `exerciseSlug` regardless of equipment — used for Achilles-role slots,
   * which variant selection must never touch (see AchillesRole).
   */
  variants?: SlotVariant[];
}

export interface SessionTemplate {
  type: StrengthSessionType;
  title: string;
  targetDurationMinutes: number;
  effortNote?: string;
  slots: TemplateSlot[];
}

/** A logged set as returned to progression/history logic. */
/**
 * A warm-up ramp set, a real working set, a working set the athlete added
 * beyond the prescription ("extra" — capacity evidence, see progression.ts),
 * or a prescribed working set the athlete finished the session without
 * logging ("skipped" — see the strength_sets.kind comment in db/schema.ts for
 * why this is its own value rather than just a missing row). Absent means
 * working, so every row logged before "extra"/"skipped" existed is unchanged.
 */
export type SetKind = "warmup" | "working" | "extra" | "skipped";

export interface LoggedSet {
  exerciseId?: string;
  exerciseSlug?: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  rpe?: number | null;
  /** Undefined/null reads as "working", so pre-existing rows are unaffected. */
  kind?: SetKind | null;
}

/** Why a session ended with fewer working sets logged than prescribed — see
 *  strength_sessions.cutShortReason in db/schema.ts. Only meaningful when
 *  this exercise actually had a skipped set in this session; the history
 *  query only sets it in that case (see service.ts getExerciseHistoryBySlug),
 *  so a session that fully completed this exercise never carries one even if
 *  another exercise that day was cut short — the signal belongs to the
 *  exercise, not the session. */
export type CutShortReason = "time" | "fatigue";

/** A prior session's sets for one exercise, newest-first by session date. */
export interface ExerciseSessionHistory {
  sessionId: string;
  date: Date;
  sets: LoggedSet[];
  /** See CutShortReason above. Undefined/null = this exercise wasn't cut
   *  short in this session (or the athlete answered/implied "time"). */
  cutShortReason?: CutShortReason | null;
}

/**
 * The 1/2/3… number an athlete sees for a set, counting only working sets
 * (warm-ups aren't numbered against it — they show a "WU" tag instead, see
 * GuidedSession's SetTag). `arr` must be in the order the sets were
 * performed (ascending `setNumber`/array order); a warm-up before the first
 * working set returns 0, which callers never render (they only show this
 * number for working-kind rows).
 *
 * This is deliberately a *display* derivation, not the persisted
 * `setNumber` column — the column stays a raw, unique (session, exercise)
 * position so the upsert key and ordering never change, while this function
 * is the single source of truth for what the athlete is shown, applied the
 * same way to old rows (kind === null reads as "working", so a pre-warm-up
 * session's raw setNumber already equalled its working count) and new ones.
 */
export function workingSetNumber(
  arr: Array<{ kind?: SetKind | null }>,
  index: number
): number {
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (arr[i]?.kind !== "warmup") n++;
  }
  return n;
}

// Session volume (kg × reps, dumbbell-scaled, bodyweight-aware) lives in
// lib/strength/volume.ts's sessionVolume() — the canonical implementation
// every screen uses, not a per-file reimplementation. See that module's
// header for why a naive kg × reps sum here was wrong (no dumbbell scaling,
// bodyweight sets silently contributing zero).
