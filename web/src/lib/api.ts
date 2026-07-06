// Thin fetch wrapper for internal API calls. On a 401 it broadcasts a global
// event so the SessionProvider can surface the Connect screen instead of every
// caller failing silently. Use this in place of bare fetch() for /api/* calls.

export const UNAUTHORIZED_EVENT = "kadenz:unauthorized";

export async function apiFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}
