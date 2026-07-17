import type {
  GuidedSessionInfo,
  PlannedExercise,
} from "@/components/strength/GuidedSession";

// ── In-progress guided-session snapshot ───────────────────────────────────────
// Persisted to localStorage on every meaningful change so an accidental exit
// (or page reload) never loses a workout: the strength page offers to resume
// from the last saved position. Cleared on completion; kept on "Leave".

export interface GuidedWorkSet {
  kg: number;
  reps: number;
  logged: boolean;
  durationSec: number;
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
