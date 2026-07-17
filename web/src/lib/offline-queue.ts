// Offline mutation queue: when a small idempotent mutation (workout tick,
// strength status) fails because the network is down, park it in localStorage
// and replay when connectivity returns. Replay preserves order; entries are
// dropped after a successful response OR a definitive server rejection
// (4xx other than 408/429) so a bad request can't wedge the queue forever.

import { apiFetch } from "@/lib/api";

const KEY = "kadenz_offline_queue_v1";
const MAX_AGE_MS = 48 * 3600_000;
const MAX_ENTRIES = 50;

export interface QueuedMutation {
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
    return list.filter((m) => Date.now() - m.ts < MAX_AGE_MS);
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

export function queuedCount(): number {
  return readQueue().length;
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
  try {
    const res = await apiFetch(url, {
      method: init.method,
      headers: { "Content-Type": "application/json" },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    return { ok: res.ok, offline: false, res };
  } catch {
    // fetch threw → network failure. Park it.
    writeQueue([...readQueue(), { url, method: init.method, body: init.body, ts: Date.now() }]);
    return { ok: true, offline: true };
  }
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
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
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
    writeQueue(remaining);
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
