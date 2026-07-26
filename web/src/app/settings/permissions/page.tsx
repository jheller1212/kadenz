"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { MapPin, Bell } from "lucide-react";
import { ListGroup, Row } from "@/components/ui/List";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { PermissionPrimer } from "@/components/PermissionPrimer";
import { loadSettings, type UserSettings } from "@/lib/settings";
import {
  requestLocationPermission,
  requestNotificationPermission,
  declineLocationPrimer,
  declineNotificationsPrimer,
} from "@/lib/permissions";

const STATUS_LABEL: Record<UserSettings["locationPermission"], string> = {
  unset: "Not asked yet",
  allowed: "On",
  declined: "Off",
};

type Primer = "location" | "notifications" | null;

/**
 * The declined-permission "honest state" from the design brief: a deliberate
 * row instead of a silent hole, with a way back into the primer rather than
 * a dead end pointing at browser settings the app can't open for you.
 */
export default function PermissionsSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [primer, setPrimer] = useState<Primer>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(loadSettings());
  }, []);

  function refresh() {
    setSettings(loadSettings());
  }

  return (
    <SettingsSubpage title="Permissions">
      {settings && (
        <ListGroup footer="Kadenz only ever asks for these after explaining why, and declining never blocks the app. Weather falls back to your approximate location, and runs still track time without GPS.">
          <Row
            icon={<MapPin className="h-4 w-4 text-text-2" strokeWidth={1.9} />}
            title="Location"
            subtitle={STATUS_LABEL[settings.locationPermission]}
            chevron={settings.locationPermission !== "allowed"}
            onClick={
              settings.locationPermission !== "allowed" ? () => setPrimer("location") : undefined
            }
          />
          <Row
            icon={<Bell className="h-4 w-4 text-text-2" strokeWidth={1.9} />}
            title="Notifications"
            subtitle={STATUS_LABEL[settings.notificationsPermission]}
            chevron={settings.notificationsPermission !== "allowed"}
            onClick={
              settings.notificationsPermission !== "allowed"
                ? () => setPrimer("notifications")
                : undefined
            }
          />
        </ListGroup>
      )}

      <AnimatePresence>
        {primer === "location" && (
          <PermissionPrimer
            icon={MapPin}
            title="Weather where you run"
            body="Your location lets us show the conditions for today's session, and warn you when heat or wind should change your target pace."
            allowLabel="Allow location"
            onAllow={() => {
              requestLocationPermission(
                () => refresh(),
                () => refresh(),
              );
              setPrimer(null);
            }}
            onDismiss={() => {
              declineLocationPrimer();
              setPrimer(null);
              refresh();
            }}
          />
        )}
        {primer === "notifications" && (
          <PermissionPrimer
            icon={Bell}
            title="Only what needs you"
            body="A schedule change to today's session, or a sync that's stopped pulling in your runs. Nothing else, and you can turn it off again here."
            allowLabel="Allow notifications"
            onAllow={async () => {
              await requestNotificationPermission();
              setPrimer(null);
              refresh();
            }}
            onDismiss={() => {
              declineNotificationsPrimer();
              setPrimer(null);
              refresh();
            }}
          />
        )}
      </AnimatePresence>
    </SettingsSubpage>
  );
}
