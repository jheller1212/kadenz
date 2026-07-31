import type { CapacitorConfig } from "@capacitor/cli";

// The shell ships the statically exported web front end and talks to the
// hosted API over the network. `webDir` points at what `npm run build:shell`
// produces in web/, so there is one build of the UI and the shell never
// carries its own copy of any screen.
const config: CapacitorConfig = {
  appId: "com.kadenz.app",
  appName: "Kadenz",
  webDir: "../web/out",

  // A native app has no address bar to report a load failure, so a wrong path
  // here shows a white screen with no explanation. Fail the build instead.
  loggingBehavior: "production",

  server: {
    // Android serves the local bundle over https rather than http so the
    // WebView treats it as a secure context. Without that, the geolocation and
    // notification APIs the run screen relies on are unavailable, which would
    // look like a bug in the app rather than a scheme problem.
    androidScheme: "https",
  },

  plugins: {
    PushNotifications: {
      // Show the notification even when the app is in the foreground. A
      // reminder that fires while the athlete happens to have Kadenz open
      // should still be visible: silently dropping it is the failure this
      // whole workstream exists to remove.
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      // The web app draws its own launch screen (BootSplash) on an always-dark
      // background. Matching the colour here means no flash of a different
      // shade in the handover from native splash to web.
      backgroundColor: "#0A0A0B",
      launchAutoHide: true,
      launchShowDuration: 0,
    },
  },
};

export default config;
