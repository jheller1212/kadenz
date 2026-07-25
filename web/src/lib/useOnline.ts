"use client";

import { useEffect, useState } from "react";

/**
 * Tracks connectivity for UI that should react to it.
 *
 * Starts optimistic (true) rather than reading navigator.onLine during render:
 * the server has no such value, so seeding from it would hydrate-mismatch. The
 * real value lands in the effect on the first client frame.
 *
 * navigator.onLine only reports whether the device has *a* network, not whether
 * requests actually succeed, so treat this as a hint for messaging — never as
 * the gate on attempting a request.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
