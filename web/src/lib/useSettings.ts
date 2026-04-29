"use client";

import { useState, useEffect } from "react";
import { loadSettings, type UserSettings, DEFAULT_SETTINGS } from "./settings";

/** Hook to read user settings reactively */
export function useSettings(): UserSettings {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
    const interval = setInterval(() => setSettings(loadSettings()), 500);
    return () => clearInterval(interval);
  }, []);

  return settings;
}
