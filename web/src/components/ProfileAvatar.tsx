"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { getActiveProfile } from "@/lib/profile-client";
import { loadOwnerAvatar, loadOwnerProfile, PROFILE_CHANGED_EVENT } from "@/lib/owner-profile";

/**
 * Profile avatar shown top-left in the nav on top-level screens.
 * Opens Settings ("Me"). Shows the owner's photo (or initial) normally, and
 * the guest's initial while a household profile is active, so it's always
 * obvious whose data is on screen.
 */
export function ProfileAvatar() {
  const [initial, setInitial] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const p = getActiveProfile();
      if (p) {
        // Household guest active — show their initial, never the owner photo.
        setPhoto(null);
        setInitial(p.name ? p.name.trim().charAt(0).toUpperCase() : null);
        return;
      }
      setPhoto(loadOwnerAvatar());
      const owner = loadOwnerProfile();
      setInitial(owner.name ? owner.name.trim().charAt(0).toUpperCase() : null);
    };
    sync();
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
  }, []);

  return (
    <TransitionLink
      href="/settings"
      buzz
      aria-label="Profile and settings"
      className="press flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-accent/15 ring-1 ring-inset ring-accent/30"
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data-URL avatar
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : initial ? (
        <span className="text-[15px] font-bold leading-none text-accent-fg">
          {initial}
        </span>
      ) : (
        <User className="h-[18px] w-[18px] text-accent-fg" strokeWidth={2} />
      )}
    </TransitionLink>
  );
}
