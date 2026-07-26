/**
 * Location & notification permission gating.
 *
 * Rule the whole app follows: never call `navigator.geolocation.*` or
 * `Notification.requestPermission()` unless `settings.locationPermission` /
 * `notificationsPermission` is already "allowed" — which only happens after
 * the athlete answers a `PermissionPrimer` sheet. A cold OS prompt (fired the
 * instant a feature happens to run) is what this exists to prevent.
 *
 * The OS-level permission is still the ground truth, though: someone can
 * grant or revoke it from browser settings outside the app entirely. So this
 * module also reconciles our mirror toward whatever the Permissions /
 * Notification API reports whenever it has actually resolved, without ever
 * triggering a prompt itself (`permissions.query` and `Notification.permission`
 * are both prompt-free reads).
 */
import { loadSettings, saveSettings } from "./settings";

/** Read-only, prompt-free reconciliation — call on app mount. */
export async function syncPermissionState(): Promise<void> {
  if (typeof navigator === "undefined") return;
  const settings = loadSettings();
  const patch: Partial<ReturnType<typeof loadSettings>> = {};

  if ("geolocation" in navigator && "permissions" in navigator) {
    try {
      const status = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      if (status.state === "granted" && settings.locationPermission !== "allowed") {
        patch.locationPermission = "allowed";
      } else if (status.state === "denied" && settings.locationPermission !== "declined") {
        patch.locationPermission = "declined";
      }
    } catch {
      /* Permissions API query rejected (unsupported name in this browser) — leave as-is */
    }
  }

  if (typeof Notification !== "undefined") {
    if (Notification.permission === "granted" && settings.notificationsPermission !== "allowed") {
      patch.notificationsPermission = "allowed";
    } else if (Notification.permission === "denied" && settings.notificationsPermission !== "declined") {
      patch.notificationsPermission = "declined";
    }
  }

  if (Object.keys(patch).length > 0) {
    saveSettings({ ...settings, ...patch });
  }
}

/** True only once the athlete has explicitly allowed location via a primer. */
export function locationAllowed(): boolean {
  return loadSettings().locationPermission === "allowed";
}

/**
 * Requests the real browser geolocation permission. Only call this from a
 * primer's "Allow" handler — this is the one place in the app the OS prompt
 * is allowed to fire.
 */
export function requestLocationPermission(
  onGranted: (pos: GeolocationPosition) => void,
  onDenied: () => void,
): void {
  const settings = loadSettings();
  if (!("geolocation" in navigator)) {
    saveSettings({ ...settings, locationPermission: "declined" });
    onDenied();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      saveSettings({ ...loadSettings(), locationPermission: "allowed" });
      onGranted(pos);
    },
    () => {
      saveSettings({ ...loadSettings(), locationPermission: "declined" });
      onDenied();
    },
    { timeout: 8000 },
  );
}

/** Records a "Not now" — leaves the OS-level permission untouched. */
export function declineLocationPrimer(): void {
  const settings = loadSettings();
  saveSettings({ ...settings, locationPermission: "declined" });
}

/**
 * Requests the real Notification permission. Only call from a primer's
 * "Allow" handler, same contract as requestLocationPermission.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = loadSettings();
  if (typeof Notification === "undefined") {
    saveSettings({ ...settings, notificationsPermission: "declined" });
    return false;
  }
  try {
    const result = await Notification.requestPermission();
    const allowed = result === "granted";
    saveSettings({ ...loadSettings(), notificationsPermission: allowed ? "allowed" : "declined" });
    return allowed;
  } catch {
    saveSettings({ ...loadSettings(), notificationsPermission: "declined" });
    return false;
  }
}

export function declineNotificationsPrimer(): void {
  const settings = loadSettings();
  saveSettings({ ...settings, notificationsPermission: "declined" });
}
