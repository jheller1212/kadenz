"use client";

import { useState, useEffect } from "react";
import { loadSettings, type UserSettings, DEFAULT_SETTINGS, SETTINGS_CHANGED_EVENT } from "./settings";

/** Hook to read user settings reactively */
export function useSettings(): UserSettings {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    sync();
    // Same-tab saves dispatch SETTINGS_CHANGED_EVENT; "storage" covers other tabs
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return settings;
}
