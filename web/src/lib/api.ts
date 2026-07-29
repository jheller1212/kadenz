// Thin fetch wrapper for internal API calls. On a 401 it broadcasts a global
// event so the SessionProvider can surface the Connect screen instead of every
// caller failing silently. Use this in place of bare fetch() for /api/* calls.

export const UNAUTHORIZED_EVENT = "kadenz:unauthorized";

// Where the API lives, relative to whatever is running this code.
//
// Empty on the web: the front end and the API routes are the same deployment,
// so "/api/x" resolves against the page's own origin and nothing changes.
//
// Set for the native shell, which serves the front end from local files inside
// the WebView (origin `capacitor://localhost` on iOS, `http://localhost` on
// Android) while the API stays on Vercel. Relative URLs there would resolve to
// the local bundle, which has no API routes in it at all, so every call needs
// an absolute base. See ../../native/README.md.
//
// Read from the environment rather than hardcoded so the shell can be pointed
// at a preview deployment without a code change. It carries no secret, which
// is why NEXT_PUBLIC_ is the right prefix: it is a URL, safe to publish.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Resolves an app-relative API path against the configured API origin. */
export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  if (!path.startsWith("/")) return `${API_BASE_URL}/${path}`;
  return `${API_BASE_URL}${path}`;
}

/** True when API calls leave the origin serving the UI, as in the shell. */
export function apiIsCrossOrigin(): boolean {
  return API_BASE_URL !== "";
}

export async function apiFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  // The session cookie is not attached to a cross-origin request unless the
  // request explicitly asks for it. Same-origin (the web app) keeps fetch's
  // default so this change cannot alter existing behaviour.
  const credentials: RequestCredentials | undefined = apiIsCrossOrigin()
    ? "include"
    : init?.credentials;

  const res = await fetch(apiUrl(input), { ...init, credentials });
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}
