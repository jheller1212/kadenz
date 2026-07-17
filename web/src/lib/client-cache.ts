// Tiny stale-while-revalidate cache for client screens: paint instantly from
// the last snapshot, then refresh from the network. Cache is display-only —
// never a source of truth for mutations.

const PREFIX = "kadenz_cache:";

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
  } catch {
    /* storage full/unavailable — cache is best-effort */
  }
}
