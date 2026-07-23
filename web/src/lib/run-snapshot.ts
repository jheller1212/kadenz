// ── In-progress guided-run snapshot ───────────────────────────────────────────
// Persisted to localStorage so a run can be minimized (leave the run screen and
// keep the clock counting, like a parked strength session) or survive a reload.
// The workout page offers to resume it; the floating pill routes back to it.
// The elapsed clock is timestamp-based, so it keeps advancing while parked —
// matching the lift-session behaviour. GPS distance resumes from the saved
// metres (it can't accrue while the run screen is unmounted).

export interface RunSnapshot {
  v: 1;
  /** When this snapshot was last written. */
  savedAt: number;
  /** The workout this run belongs to (route target for resume). */
  workoutId: string;
  title: string;
  useMiles: boolean;
  /** Run start (ms epoch), already shifted for any paused time. */
  startedAt: number;
  stepIdx: number;
  /** Accumulated GPS distance in metres. */
  distanceM: number;
  /** Split bookkeeping so completed splits aren't re-announced on resume. */
  nextSplit: number;
  splitStartSec: number;
  /** Current step's start markers (elapsed seconds / metres) for auto-advance. */
  stepStartSec: number;
  stepStartDistM: number;
}

const KEY = "kadenz_run_snapshot_v1";
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // a run older than this is stale

export function saveRunSnapshot(snap: RunSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    /* best-effort */
  }
}

/** The saved in-progress run, or null if absent/stale/corrupt. */
export function loadRunSnapshot(): RunSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as RunSnapshot;
    if (snap?.v !== 1 || !snap.workoutId || typeof snap.startedAt !== "number") return null;
    if (Date.now() - snap.savedAt > MAX_AGE_MS) return null;
    return snap;
  } catch {
    return null;
  }
}

export function clearRunSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
