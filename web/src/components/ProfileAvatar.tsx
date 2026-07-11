"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { getActiveProfile } from "@/lib/profile-client";

/**
 * Profile avatar shown top-left in the nav on top-level screens.
 * Opens Settings ("Me"). Shows the guest's initial while a household profile
 * is active, so it's always obvious whose data is on screen.
 */
export function ProfileAvatar() {
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    const p = getActiveProfile();
    setInitial(p?.name ? p.name.trim().charAt(0).toUpperCase() : null);
  }, []);

  return (
    <TransitionLink
      href="/settings"
      buzz
      aria-label="Profile and settings"
      className="press flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 ring-1 ring-inset ring-accent/30"
    >
      {initial ? (
        <span className="text-[15px] font-bold leading-none text-accent">
          {initial}
        </span>
      ) : (
        <User className="h-[18px] w-[18px] text-accent" strokeWidth={2} />
      )}
    </TransitionLink>
  );
}
