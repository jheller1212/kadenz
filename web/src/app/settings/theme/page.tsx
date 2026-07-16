"use client";

import { useEffect, useState } from "react";
import { ListGroup } from "@/components/ui/List";
import { SettingsSubpage, RadioRow } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

export default function ThemeSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(loadSettings());
  }, []);

  function setTheme(theme: UserSettings["theme"]) {
    if (!settings) return;
    const updated = { ...settings, theme };
    setSettings(updated);
    // ThemeProvider listens for the settings-changed event and re-applies.
    saveSettings(updated);
  }

  return (
    <SettingsSubpage title="Theme">
      {settings && (
        <ListGroup footer={`"Use Device Settings" follows your phone's light/dark appearance automatically.`}>
          <RadioRow
            title="Use Device Settings"
            selected={settings.theme === "system"}
            onSelect={() => setTheme("system")}
          />
          <RadioRow
            title="Light"
            selected={settings.theme === "light"}
            onSelect={() => setTheme("light")}
          />
          <RadioRow
            title="Dark"
            selected={settings.theme === "dark"}
            onSelect={() => setTheme("dark")}
          />
        </ListGroup>
      )}
    </SettingsSubpage>
  );
}
