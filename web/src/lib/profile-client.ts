"use client";

// Client side of household profile switching. The active profile lives in two
// plain cookies (id + display name) read by the API routes / avatar. Switching
// reloads the app so every fetch re-runs under the new scope.

const ID_COOKIE = "kadenz_profile";
const NAME_COOKIE = "kadenz_profile_name";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Active guest profile, or null for the owner. */
export function getActiveProfile(): { id: string; name: string } | null {
  const id = readCookie(ID_COOKIE);
  if (!id) return null;
  return { id, name: readCookie(NAME_COOKIE) ?? "" };
}

/** Switch profile (null = owner) and reload so all data refetches scoped. */
export function switchProfile(profile: { id: string; name: string } | null) {
  if (profile) {
    document.cookie = `${ID_COOKIE}=${encodeURIComponent(profile.id)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    document.cookie = `${NAME_COOKIE}=${encodeURIComponent(profile.name)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
  } else {
    document.cookie = `${ID_COOKIE}=; path=/; max-age=0`;
    document.cookie = `${NAME_COOKIE}=; path=/; max-age=0`;
  }
  // Screens paint instantly from cached snapshots; without clearing them the
  // new profile briefly sees the previous athlete's sessions.
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("kadenz_cache:")) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — the reload still fetches fresh data */
  }
  window.location.reload();
}
