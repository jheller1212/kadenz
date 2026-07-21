"use client";

import { useState, useEffect } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import { Check, Plus } from "lucide-react";
import { getActiveProfile, switchProfile } from "@/lib/profile-client";

// ── Household profiles (moved from /settings) ───────────────────────────────

interface Profile {
  id: string;
  name: string;
}

export default function HouseholdPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only init from storage
    setActive(getActiveProfile());
    apiFetch("/api/profiles")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProfiles)
      .catch(() => {});
  }, []);

  async function addProfile() {
    const name = window.prompt("Name of the household member?")?.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await apiFetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const p = (await res.json()) as Profile;
        haptic("success");
        switchProfile({ id: p.id, name: p.name });
      }
    } finally {
      setAdding(false);
    }
  }

  const check = <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />;

  return (
    <SettingsSubpage title="Household">
      <ListGroup footer="Each person gets their own strength sessions and check-ins. Runs and Strava stay with the owner.">
        <Row
          title="Owner"
          subtitle="Runs, plan & Strava"
          accessory={active === null ? check : undefined}
          onClick={() => {
            if (active !== null) switchProfile(null);
          }}
        />
        {profiles.map((p) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle="Strength & check-ins"
            accessory={active?.id === p.id ? check : undefined}
            onClick={() => {
              if (active?.id !== p.id) switchProfile({ id: p.id, name: p.name });
            }}
          />
        ))}
        <Row
          title={adding ? "Adding…" : "Add person"}
          icon={<Plus className="h-4 w-4 text-accent" strokeWidth={2.5} />}
          onClick={addProfile}
        />
      </ListGroup>
    </SettingsSubpage>
  );
}
