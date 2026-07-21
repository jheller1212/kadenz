// Guided-session audio unlock, split out so the Start button can arm audio
// (and iOS's gesture requirement) WITHOUT pulling the whole GuidedSession
// component into the initial bundle. The AudioContext singleton lives here so
// the eager unlock and the lazy-loaded component share one context.

import { CUE_VOLUME_GAIN, loadSettings } from "@/lib/settings";

let sharedAudioCtx: AudioContext | null = null;

export function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

// iOS gates speech + audio behind a user gesture, so this must be called
// synchronously from the Start button's onClick, before the component mounts.
export function unlockGuidedAudio() {
  const s = loadSettings();
  try {
    if (
      s.kraftAudio &&
      s.kraftVoice &&
      CUE_VOLUME_GAIN[s.cueVolume] > 0 &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      const u = new SpeechSynthesisUtterance("Let's go");
      u.volume = CUE_VOLUME_GAIN[s.cueVolume];
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* best-effort */
  }
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume();
  } catch {
    /* best-effort */
  }
}
