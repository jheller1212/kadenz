/** Owner profile (name, email, avatar photo) stored in localStorage. */

export interface OwnerProfile {
  name: string;
  email: string;
}

const PROFILE_KEY = "kadenz_owner_profile";
const AVATAR_KEY = "kadenz_owner_avatar";

/** Fired on window whenever the owner profile or avatar is saved. */
export const PROFILE_CHANGED_EVENT = "kadenz:profile-changed";

export function loadOwnerProfile(): OwnerProfile {
  if (typeof window === "undefined") return { name: "", email: "" };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { name: "", email: "" };
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
    };
  } catch {
    return { name: "", email: "" };
  }
}

export function saveOwnerProfile(profile: OwnerProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

/** Avatar photo as a small JPEG data-URL, or null if none set. */
export function loadOwnerAvatar(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AVATAR_KEY);
}

export function saveOwnerAvatar(dataUrl: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AVATAR_KEY, dataUrl);
  window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}
