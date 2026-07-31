// Workout type palette. Single source of truth for JS call sites; the CSS
// twins live in globals.css as --k-type-* / --k-type-*-grad and MUST be kept
// identical — the two had silently drifted (JS tempo #F2A113 vs CSS #FFB547,
// and so on for every type), so the same workout rendered a different colour
// depending on which side read it. Change both together.

export interface TypeColor {
  solid: string;
  grad: string;
}

export const WORKOUT_COLORS: Record<string, TypeColor> = {
  easy: { solid: "#4ADE80", grad: "linear-gradient(180deg, #FFE14D 0%, #4ADE80 100%)" },
  recovery: { solid: "#4ADE80", grad: "linear-gradient(180deg, #4ADE80 0%, #35E4D4 100%)" },
  tempo: { solid: "#FFE14D", grad: "linear-gradient(180deg, #FF8A3D 0%, #FFE14D 100%)" },
  interval: { solid: "#FF4D4D", grad: "linear-gradient(180deg, #FF4D4D 0%, #FF8A3D 100%)" },
  long: { solid: "#C084FC", grad: "linear-gradient(180deg, #9B6BFF 0%, #7C5CFF 100%)" },
  // Red is reserved for intervals and races, so race shares the interval ramp.
  race: { solid: "#FF4D4D", grad: "linear-gradient(180deg, #FF4D4D 0%, #FF8A3D 100%)" },
};

// Lift is the dark-theme value. It is the one type colour that differs per
// theme (light is #2563EB, which fails AA on a dark card), so anything painting
// a themed surface should prefer the CSS var --k-type-lift over this constant.
export const STRENGTH_COLOR: TypeColor = {
  solid: "#5AA0FF",
  grad: "linear-gradient(180deg, #5AA0FF 0%, #2563EB 100%)",
};

export function workoutColor(type: string): TypeColor {
  return WORKOUT_COLORS[type] ?? { solid: "#94A3B8", grad: "linear-gradient(135deg, #A8B3C1, #7C8794)" };
}

// Ink (text-safe) variant per workout type. Flat type colors like tempo
// (#FFE14D) are graphics-only — on paper (light theme) they read at ~1.2:1,
// nowhere near AA. Text must use the darkened --vi-* twins from globals.css,
// which flip back to the vivid flat value in dark theme. Always reference
// these via CSS var (never resolve to a hex in JS) so the theme switch works.
const INK_VARS: Record<string, string> = {
  easy: "var(--vi-easy)",
  recovery: "var(--vi-easy)",
  tempo: "var(--vi-tempo)",
  interval: "var(--vi-interval)",
  race: "var(--vi-interval)",
  long: "var(--vi-long)",
  // Lift already differs per theme (see --k-type-lift), so its badge text
  // reads straight off the same var the graphics use, not a separate --vi-*.
  strength: "var(--k-type-lift)",
};

export function workoutInk(type: string): string {
  return INK_VARS[type] ?? "var(--k-text-2)";
}

// The quiet radial "type wash" every activity card carries behind its
// graphics. 5% is a ceiling, not a taste call: --k-text-3 sits ~4.66:1 on the
// plain dark surface, so a stronger tint drops card metadata under AA.
export function typeWash(color: string): string {
  return `radial-gradient(95% 95% at 100% 100%, color-mix(in srgb, ${color} 5%, var(--k-surface)) 0%, color-mix(in srgb, ${color} 2%, var(--k-surface)) 45%, var(--k-surface) 72%)`;
}
