"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/ui/NavBar";
import { BottomNav } from "@/components/BottomNav";
import { ListGroup, Row } from "@/components/ui/List";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import {
  loadOwnerAvatar,
  loadOwnerProfile,
  saveOwnerAvatar,
  saveOwnerProfile,
  PROFILE_CHANGED_EVENT,
} from "@/lib/owner-profile";
import {
  ChevronLeft,
  ClipboardList,
  Radio,
  Dumbbell,
  Ruler,
  Heart,
  Moon,
  Vibrate,
  Link2,
  Users,
  Camera,
  LogOut,
} from "lucide-react";
import pkg from "../../../package.json";

// ── Edit profile sheet ───────────────────────────────────────────────────────

/** Downscale a picked image to a small square JPEG data-URL via canvas. */
async function downscaleToDataUrl(file: File, size = 192): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read image"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    // Cover-crop: scale the shorter side to `size` and center.
    const scale = size / Math.min(img.width, img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function EditProfileSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const p = loadOwnerProfile();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from localStorage on open
    setName(p.name);
    setEmail(p.email);
    setPhoto(loadOwnerAvatar());
  }, [open]);

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await downscaleToDataUrl(file);
      setPhoto(dataUrl);
      saveOwnerAvatar(dataUrl);
      haptic("light");
    } catch {
      /* unreadable image — keep the current photo */
    }
  }

  function save() {
    saveOwnerProfile({ name: name.trim(), email: email.trim() });
    haptic("success");
    onClose();
  }

  const inputClass =
    "w-full rounded-xl bg-elevated px-4 py-3 text-[15px] text-text-1 placeholder:text-text-3 outline-none focus:ring-2 focus:ring-accent";

  return (
    <Sheet open={open} onClose={onClose} title="Edit Profile">
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="press relative h-[100px] w-[100px] overflow-hidden rounded-full bg-accent"
            aria-label="Change profile photo"
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data-URL avatar
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[40px] font-bold text-on-accent">
                {name.trim() ? name.trim().charAt(0).toUpperCase() : "R"}
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/45 py-1.5">
              <Camera className="h-4 w-4 text-white" strokeWidth={2.2} />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPickPhoto(e.target.files?.[0])}
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-text-2">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Runner"
            autoComplete="name"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-text-2">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={inputClass}
          />
        </label>

        <Button onClick={save}>Save</Button>
      </div>
    </Sheet>
  );
}

// ── Main Settings Page ──────────────────────────────────────────────────────

const PREFERENCE_ROWS = [
  { href: "/settings/workouts", label: "Workouts", icon: ClipboardList },
  { href: "/settings/recording", label: "Recording", icon: Radio },
  { href: "/settings/kraft", label: "Kraft", icon: Dumbbell },
  { href: "/settings/units", label: "Units", icon: Ruler },
  { href: "/settings/hr-zones", label: "Heart Rate Zones", icon: Heart },
  { href: "/settings/theme", label: "Theme", icon: Moon },
  { href: "/settings/haptics", label: "Haptics", icon: Vibrate },
  { href: "/settings/apps", label: "Connected Apps", icon: Link2 },
  { href: "/settings/household", label: "Household", icon: Users },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<{ name: string; email: string } | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    // Deferred to after hydration on purpose (localStorage isn't available
    // during SSR, and reading it in render would cause a hydration mismatch).
    const sync = () => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(loadOwnerProfile());
      setAvatar(loadOwnerAvatar());
    };
    sync();
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
  }, []);

  async function signOut() {
    setSigningOut(true);
    haptic("medium");
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* clear-cookie is best-effort; still leave the app */
    }
    window.location.href = "/";
  }

  const displayName = profile?.name?.trim() || "Runner";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title=""
        large={false}
        left={
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="press flex h-11 w-11 items-center justify-center -ml-2 rounded-lg active:bg-elevated"
          >
            <ChevronLeft className="h-6 w-6 text-text-1" strokeWidth={2.2} />
          </button>
        }
      />

      <div className="px-4 pb-tabbar">
        {/* Profile block */}
        <section className="mb-8 flex flex-col items-center pt-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            aria-label="Edit profile"
            className="press h-[100px] w-[100px] overflow-hidden rounded-full bg-accent"
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data-URL avatar
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[40px] font-bold text-on-accent">
                {initial}
              </span>
            )}
          </button>
          <h2 className="mt-3 text-[22px] font-extrabold tracking-tight text-text-1">
            {displayName}
          </h2>
          {profile?.email?.trim() && (
            <p className="mt-0.5 text-[13px] text-text-3">{profile.email.trim()}</p>
          )}
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setEditOpen(true);
            }}
            className="press mt-3 rounded-full bg-text-1 px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-bg"
          >
            Edit Profile
          </button>
        </section>

        {/* Preferences */}
        <h3 className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-text-3">
          My Preferences
        </h3>
        <div className="mb-8 overflow-hidden k-card">
          {PREFERENCE_ROWS.map(({ href, label, icon: Icon }) => (
            <Row
              key={href}
              icon={<Icon className="h-4 w-4 text-text-2" strokeWidth={1.9} />}
              title={label}
              chevron
              onClick={() => router.push(href)}
            />
          ))}
        </div>

        {/* Sign out */}
        <button
          type="button"
          disabled={signingOut}
          onClick={signOut}
          className="press flex w-full items-center justify-center gap-2 rounded-full bg-text-1 py-3.5 text-[15px] font-bold text-bg disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" strokeWidth={2.2} />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>

        <p className="mb-4 mt-6 text-center text-[12px] uppercase tracking-wider text-text-3">
          Kadenz · v{pkg.version}
        </p>
      </div>

      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />
      <BottomNav />
    </main>
  );
}
