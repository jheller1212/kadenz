// Best-effort haptic feedback that works across platforms.
//
// - Android / Chrome: the Vibration API (navigator.vibrate) works.
// - iOS Safari: navigator.vibrate is a silent no-op (WebKit never shipped it).
//   Since iOS 18 a real system haptic fires when a <label> tied to a
//   `<input type="checkbox" switch>` is activated. We lazily create a hidden
//   switch and .click() its label. Apple has tightened this over time, so treat
//   iOS haptics as non-guaranteed — never make UX depend on the buzz landing.

type Pattern = "light" | "medium" | "heavy" | "success" | "warning" | number | number[];

const VIBRATE_MS: Record<string, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 35,
  success: [15, 40, 15],
  warning: [30, 60, 30],
};

let iosLabel: HTMLLabelElement | null = null;

function ensureIosSwitch(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (iosLabel) return iosLabel;
  try {
    const input = document.createElement("input");
    input.type = "checkbox";
    // The `switch` attribute is what enables the iOS system haptic.
    input.setAttribute("switch", "");
    input.style.display = "none";
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const id = "kadenz-haptic-switch";
    input.id = id;
    label.htmlFor = id;
    document.body.appendChild(input);
    document.body.appendChild(label);
    iosLabel = label;
    return label;
  } catch {
    return null;
  }
}

const isIOS = (): boolean =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.platform) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)));

/** Fire a haptic. Safe to call anywhere; silently degrades. */
export function haptic(pattern: Pattern = "light"): void {
  const ms =
    typeof pattern === "number" || Array.isArray(pattern)
      ? pattern
      : VIBRATE_MS[pattern] ?? 10;

  try {
    if (isIOS()) {
      // Toggling the switch's label fires the iOS system haptic.
      ensureIosSwitch()?.click();
      return;
    }
    navigator.vibrate?.(ms);
  } catch {
    /* haptics are best-effort */
  }
}
