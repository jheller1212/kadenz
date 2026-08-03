import type { StrengthSessionType } from "./types";

// ── Constraint engine extensions ──────────────────────────────────────────────
//
// Strength and running negotiate for the same days. Rules (from the handoff):
//   - No Lower+Achilles session the day before a hard run (interval/tempo).
//     Calf HSR the day before a long easy run is fine.
//   - Explosive Achilles work and interval runs never on the same day.
//   - Lower day + long run same day → warn, allow (user override).
//   - Achilles blocks capped at 3 per rolling 7 days.

/** Run workout types that count as a "hard session" (existing definition). */
export const HARD_RUN_TYPES = new Set(["interval", "tempo", "race"]);

export const ACHILLES_FREQUENCY_CAP = 3;
export const ACHILLES_WINDOW_DAYS = 7;

export type ConstraintSeverity = "error" | "warn";

export interface ConstraintViolation {
  code: string;
  severity: ConstraintSeverity;
  message: string;
}

export interface RunRef {
  date: Date | string;
  type: string;
}

export interface StrengthRef {
  date: Date | string;
  type: StrengthSessionType;
  /** Excluded from cap/collision checks when re-validating a moved session. */
  id?: string;
}

// ── Date helpers (local-day granularity) ──────────────────────────────────────

function startOfLocalDay(d: Date | string): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayDiff(a: Date | string, b: Date | string): number {
  return Math.round((startOfLocalDay(a) - startOfLocalDay(b)) / DAY_MS);
}

function sameDay(a: Date | string, b: Date | string): boolean {
  return dayDiff(a, b) === 0;
}

/**
 * Whether a session of this `type` carries the Achilles/HSR block. True for
 * the dedicated "achilles" type (scheduled as its own session — see
 * reconcile.ts computeAchillesPlacements) and the historic lower_achilles/
 * upper_achilles combo types (kept only so old sessions still trip these
 * rules). A reported Achilles complaint no longer reshapes a plain
 * lower/upper/full_body session with this block (see program.ts
 * sessionTemplateFor) — it gets its own "achilles" session instead — so
 * those types never carry it regardless of complaints.
 */
export function hasAchillesBlock(type: StrengthSessionType): boolean {
  return type === "lower_achilles" || type === "upper_achilles" || type === "achilles";
}

export function hasExplosiveWork(type: StrengthSessionType): boolean {
  // Explosive Achilles work (box step-up) lives on every Achilles-block day.
  return hasAchillesBlock(type);
}

function isLowerDay(type: StrengthSessionType): boolean {
  // full_body loads the legs too — it reaches this validator now that the
  // schema accepts every session type, and should get the same heavy-legs
  // warning as a dedicated lower day.
  return type === "lower" || type === "lower_achilles" || type === "full_body";
}

// ── Core validation ───────────────────────────────────────────────────────────

/**
 * Validate placing (or moving) a strength session on a date against the run
 * schedule and other strength sessions. Returns all violations; callers treat
 * `warn` as overridable and `error` as blocking (consistent with the existing
 * dnd-kit override UX).
 */
export function validateStrengthPlacement(params: {
  session: StrengthRef;
  runWorkouts: RunRef[];
  strengthSessions: StrengthRef[];
}): ConstraintViolation[] {
  const { session } = params;
  const violations: ConstraintViolation[] = [];

  const runsSameDay = params.runWorkouts.filter((r) => sameDay(r.date, session.date));
  const runsNextDay = params.runWorkouts.filter(
    (r) => dayDiff(r.date, session.date) === 1
  );

  // Rule: no Lower+Achilles the day before a hard run.
  if (hasAchillesBlock(session.type)) {
    const hardNextDay = runsNextDay.find((r) => HARD_RUN_TYPES.has(r.type));
    if (hardNextDay) {
      violations.push({
        code: "achilles_before_hard_run",
        severity: "error",
        message: `Lower + Achilles sits the day before a ${hardNextDay.type} run. Move it so the calves are fresh for the hard session.`,
      });
    }
  }

  // Rule: explosive Achilles work and interval runs never on the same day.
  if (hasExplosiveWork(session.type)) {
    const intervalSameDay = runsSameDay.find((r) => r.type === "interval");
    if (intervalSameDay) {
      violations.push({
        code: "explosive_with_interval",
        severity: "error",
        message:
          "Explosive Achilles work and interval running shouldn't share a day. Separate them.",
      });
    }
  }

  // Rule: lower day + long run same day → warn, allow.
  if (isLowerDay(session.type)) {
    const longSameDay = runsSameDay.find((r) => r.type === "long");
    if (longSameDay) {
      violations.push({
        code: "lower_with_long_run",
        severity: "warn",
        message:
          "Lower strength shares a day with your long run: heavy legs. Allowed, but consider spacing them.",
      });
    }
  }

  // Rule: Achilles blocks capped at 3 per rolling 7 days.
  if (hasAchillesBlock(session.type)) {
    const others = params.strengthSessions.filter(
      (s) => s.id == null || s.id !== session.id
    );
    const achillesDates = [
      session.date,
      ...others.filter((s) => hasAchillesBlock(s.type)).map((s) => s.date),
    ];
    // Every rolling 7-day window containing this session must hold ≤ cap.
    let maxInWindow = 0;
    for (let offset = 0; offset < ACHILLES_WINDOW_DAYS; offset++) {
      const windowStart = startOfLocalDay(session.date) - offset * DAY_MS;
      const windowEnd = windowStart + (ACHILLES_WINDOW_DAYS - 1) * DAY_MS;
      const count = achillesDates.filter((d) => {
        const t = startOfLocalDay(d);
        return t >= windowStart && t <= windowEnd;
      }).length;
      if (count > maxInWindow) maxInWindow = count;
    }
    if (maxInWindow > ACHILLES_FREQUENCY_CAP) {
      violations.push({
        code: "achilles_frequency_cap",
        severity: "error",
        message: `That would put ${maxInWindow} Achilles blocks in a 7-day window (max ${ACHILLES_FREQUENCY_CAP}).`,
      });
    }
  }

  return violations;
}

/** Highest severity present, or null when there are no violations. */
export function worstSeverity(
  violations: ConstraintViolation[]
): ConstraintSeverity | null {
  if (violations.some((v) => v.severity === "error")) return "error";
  if (violations.some((v) => v.severity === "warn")) return "warn";
  return null;
}
