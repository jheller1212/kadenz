"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Production only. sw.js serves /_next/static/ cache-first because those
    // URLs are content-hashed in a real build, so a cached copy can never be
    // wrong. `next dev` reuses the same paths (main-app.js, app/<route>/page.js)
    // for every recompile, so the same rule hands the page a stale chunk after
    // a rebuild: the webpack runtime mismatches, hydration never completes, and
    // the app sits on the boot splash forever with no error. Nothing in dev
    // needs the offline cache.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.error("SW registration failed:", err));
    }
  }, []);

  return null;
}
