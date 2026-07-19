// Offline mutation queue: when a small idempotent mutation (workout tick,
// strength status) fails because the network is down, park it in localStorage
// and replay when connectivity returns. Replay preserves order; entries are
// dropped after a successful response OR a definitive server rejection
// (4xx other than 408/429) so a bad request can't wedge the queue forever.

import { apiFetch } from "@/lib/api";
import { isRetryableStatus } from "@/lib/retryable-status";

const KEY = "kadenz_offline_queue_v1";
const MAX_AGE_MS = 48 * 3600_000;
// Generous: a single guided workout can log 30+ sets, and the cap drops the
// OLDEST entries — too tight a bound would silently discard real work.
const MAX_ENTRIES = 300;

export interface QueuedMutation {
  /** Stable identity — lets a flush merge instead of clobbering new writes. */
  id: string;
  url: string;
  method: string;
  body?: string;
  ts: number;
}

function readQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as QueuedMutation[];
    return list
      // Legacy rows (queued before ids existed) must get the SAME id on every
      // read — a fresh random one would make the flush merge treat an
      // already-sent row as new and replay it forever.
      .map((m) => (m.id ? m : { ...m, id: legacyId(m) }))
      .filter((m) => Date.now() - m.ts < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeQueue(list: QueuedMutation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    /* storage unavailable — queue is best-effort */
  }
}

/**
 * Run a mutation now; if the network is down, queue it for replay and resolve
 * as accepted-offline. Server errors (response received) are NOT queued —
 * they're real answers the caller must handle.
 */
export async function mutateWithQueue(
  url: string,
  init: { method: string; body?: string }
): Promise<{ ok: boolean; offline: boolean; res?: Response }> {
  // Ordering guarantee: once anything for this endpoint is parked, later
  // writes queue behind it. A live write that jumped the queue could be
  // overwritten moments later by the stale replay sitting in front of it.
  if (hasQueuedFor(url)) {
    enqueue(url, init);
    void flushQueue();
    return { ok: true, offline: true };
  }

  try {
    const res = await apiFetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json" },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    // A server that is down or throttling is no more the caller's problem
    // than a dead network — park those too, so the write is never lost.
    if (isRetryableStatus(res.status)) {
      enqueue(url, init);
      return { ok: true, offline: true };
    }
    return { ok: res.ok, offline: false, res };
  } catch {
    // fetch threw → network failure. Park it.
    enqueue(url, init);
    return { ok: true, offline: true };
  }
}

function enqueue(url: string, init: { method: string; body?: string }): void {
  updateQueue((list) => [
    ...list,
    { id: newId(), url, method: init.method, body: init.body, ts: Date.now() },
  ]);
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function legacyId(m: { ts: number; url: string; method: string }): string {
  return `legacy-${m.ts}-${m.method}-${m.url}`;
}

/** Read-modify-write in one step, re-reading immediately before the write so
 *  a concurrent enqueue is far less likely to be clobbered. */
function updateQueue(fn: (list: QueuedMutation[]) => QueuedMutation[]): void {
  writeQueue(fn(readQueue()));
}

/** True when this exact endpoint already has parked writes. */
function hasQueuedFor(url: string): boolean {
  return readQueue().some((m) => m.url === url);
}

/** Queued mutations whose URL contains `match` — lets a screen track its own. */
export function queuedCountFor(match: string): number {
  return readQueue().filter((m) => m.url.includes(match)).length;
}

let flushing = false;

/** Replay queued mutations in order. Safe to call often. */
export async function flushQueue(): Promise<void> {
  if (flushing || typeof window === "undefined" || !navigator.onLine) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  flushing = true;
  try {
    const remaining: QueuedMutation[] = [];
    for (let i = 0; i < queue.length; i++) {
      const m = queue[i];
      try {
        const res = await apiFetch(m.url, {
          method: m.method,
          headers: { "Content-Type": "application/json" },
          ...(m.body !== undefined ? { body: m.body } : {}),
        });
        const retryable = isRetryableStatus(res.status);
        if (retryable) {
          remaining.push(...queue.slice(i));
          break;
        }
        // ok or definitive rejection → drop either way
      } catch {
        // still offline — keep this and the rest, try again later
        remaining.push(...queue.slice(i));
        break;
      }
    }
    // Anything enqueued WHILE this flush ran is in storage but not in our
    // snapshot — merge it back, or those writes would be silently dropped.
    const handled = new Set(queue.map((m) => m.id));
    updateQueue((current) => [
      ...remaining,
      ...current.filter((m) => !handled.has(m.id)),
    ]);
    if (remaining.length < queue.length) {
      window.dispatchEvent(new Event("kadenz:queue-flushed"));
    }
  } finally {
    flushing = false;
  }
}

/** Install global replay triggers (idempotent). Call once from a client root. */
let installed = false;
export function installQueueFlush(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("online", () => void flushQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flushQueue();
  });
  void flushQueue();
}
