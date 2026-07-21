// Tiny stale-while-revalidate cache for client screens: paint instantly from
// the last snapshot, then refresh from the network. Cache is display-only —
// never a source of truth for mutations.

const PREFIX = "kadenz_cache:";
// Keys like strength_week:<date> are written per week viewed and never
// overwritten, so without a cap they accumulate forever. Keep the newest N.
const MAX_KEYS = 40;

export function readCache<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return (JSON.parse(raw) as { data: T }).data;
  } catch {
    return null;
  }
}

export function writeCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
    trimCache();
  } catch {
    /* storage full/unavailable — cache is best-effort */
  }
}

/** Evict the oldest cache entries once the count exceeds MAX_KEYS. */
function trimCache(): void {
  try {
    const entries: Array<{ key: string; ts: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      let ts = 0;
      try {
        ts = (JSON.parse(localStorage.getItem(k) ?? "{}") as { ts?: number }).ts ?? 0;
      } catch {
        /* corrupt entry sorts oldest */
      }
      entries.push({ key: k, ts });
    }
    if (entries.length <= MAX_KEYS) return;
    entries.sort((a, b) => a.ts - b.ts);
    for (const e of entries.slice(0, entries.length - MAX_KEYS)) {
      localStorage.removeItem(e.key);
    }
  } catch {
    /* best-effort */
  }
}
