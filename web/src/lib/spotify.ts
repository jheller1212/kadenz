// Launch Spotify so the athlete can pick music before/during a run. We don't
// integrate the Spotify API (no accounts, no scopes) — this just opens the app.
// open.spotify.com is a universal link: on iOS/Android it opens the installed
// Spotify app, and falls back to the web player when it isn't installed.
const SPOTIFY_URL = "https://open.spotify.com";

export function openSpotify(): void {
  if (typeof window === "undefined") return;
  window.open(SPOTIFY_URL, "_blank", "noopener,noreferrer");
}
