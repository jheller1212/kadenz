// Typed access to the Capacitor bridge, without taking a dependency on
// @capacitor/core in web/package.json.
//
// Capacitor injects `window.Capacitor` into the WebView at startup and exposes
// every installed plugin under `.Plugins`. Reading that global keeps the web
// bundle byte-identical for browsers: no Capacitor code ships to desktop, and
// the same static export runs in Safari, on Vercel, and inside the shell. The
// alternative (importing @capacitor/core) would add a package that is dead
// weight in every context except the shell, and would make the browser build
// depend on the native project's version.
//
// The cost is that these types are hand-written and must match the plugin API.
// They are deliberately narrow: only the calls Kadenz actually makes.

export type NativePlatform = "ios" | "android";

export interface PermissionStatus {
  receive: "prompt" | "prompt-with-rationale" | "granted" | "denied";
}

export interface PushToken {
  value: string;
}

export interface PushNotificationAction {
  notification: { data?: Record<string, unknown> };
}

interface PushNotificationsPlugin {
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  register(): Promise<void>;
  removeAllListeners(): Promise<void>;
  addListener(
    event: "registration",
    handler: (token: PushToken) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: "registrationError",
    handler: (error: { error: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: "pushNotificationActionPerformed",
    handler: (action: PushNotificationAction) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

interface FirebaseMessagingPlugin {
  getToken(): Promise<{ token: string }>;
  deleteToken(): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    PushNotifications?: PushNotificationsPlugin;
    FirebaseMessaging?: FirebaseMessagingPlugin;
  };
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the native shell, never in a browser or a home-screen PWA. */
export function isNativeShell(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

export function nativePlatform(): NativePlatform | null {
  const platform = capacitor()?.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function pushNotificationsPlugin(): PushNotificationsPlugin | undefined {
  return capacitor()?.Plugins?.PushNotifications;
}

export function firebaseMessagingPlugin(): FirebaseMessagingPlugin | undefined {
  return capacitor()?.Plugins?.FirebaseMessaging;
}
