import type {
  GuidedSessionInfo,
  PlannedExercise,
} from "@/components/strength/GuidedSession";

// ── In-progress guided-session snapshot ───────────────────────────────────────
// Persisted to localStorage on every meaningful change so an accidental exit
// (or page reload) never loses a workout: the strength page offers to resume
// from the last saved position. Cleared on completion; kept on "Leave".

export type LoadFeel = "too_heavy" | "easy" | "niggle";

export interface GuidedWorkSet {
  kg: number;
  reps: number;
  logged: boolean;
  durationSec: number;
  /** Reason chip from the "Adjust load" sheet, if the athlete gave one. */
  feel?: LoadFeel | null;
  /** Undefined/"working" = a normal set; "warmup" = a ramp set, excluded
   *  from progression and PR detection (see progression.ts/pr.ts). Optional
   *  so an in-progress session saved before this field existed still loads
   *  and reads as all-working, same convention as strength_sets.kind. */
  kind?: "warmup" | "working";
  /** True for a set the athlete added beyond the prescription ("log one
   *  more" — see guided-sets.ts). Client-side only, never sent to the API
   *  and not a DB column: the prescription itself is never persisted per
   *  session (it's re-derived from the template on every read, see
   *  session.ts), so a logged extra set can't "corrupt" it — this flag only
   *  gates the undo affordance (only ever remove the last extra set) and is
   *  absent/false for every prescribed set, including on old snapshots. */
  extra?: boolean;
}

export interface GuidedSnapshot {
  v: 1;
  /** When this snapshot was last written. */
  savedAt: number;
  /** When the guided session originally started (drives the elapsed clock). */
  startedAt: number;
  session: GuidedSessionInfo;
  exercises: PlannedExercise[];
  exIndex: number;
  work: Record<string, GuidedWorkSet[]>;
  /** Set when the workout was finished but set writes were still queued. Such
   *  a snapshot exists only to protect those writes — never offer to resume it. */
  finishedAt?: number;
}

const KEY = "kadenz_guided_session_v1";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function saveGuidedSnapshot(snap: GuidedSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    /* best-effort */
  }
}

/** The saved in-progress session, or null if absent/stale/corrupt. */
export function loadGuidedSnapshot(): GuidedSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as GuidedSnapshot;
    if (snap?.v !== 1 || !snap.session?.id || !Array.isArray(snap.exercises)) return null;
    if (Date.now() - snap.savedAt > MAX_AGE_MS) return null;
    return snap;
  } catch {
    return null;
  }
}

export function clearGuidedSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
