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

// Achilles/HSR rehab work — a standalone session or a block attached to an
// existing strength session (strength_sessions.achilles_attached). Deliberately
// distinct from STRENGTH_COLOR: the athlete asked to see rehab as its own
// labelled thing, not folded into "Kraft" blue. See docs/DESIGN.md.
export const REHAB_COLOR: TypeColor = {
  solid: "#FB923C",
  grad: "linear-gradient(180deg, #FDBA74 0%, #FB923C 100%)",
};

export function workoutColor(type: string): TypeColor {
  return WORKOUT_COLORS[type] ?? { solid: "#94A3B8", grad: "linear-gradient(135deg, #A8B3C1, #7C8794)" };
}

/**
 * A strength session's colour: rehab orange for a standalone Achilles/HSR
 * session or one the weekly rehab pass attached the block to, Kraft blue
 * otherwise. The single place this decision is made — every surface that
 * paints a strength session (day chips, week strips, the Kraft list) should
 * call this instead of reaching for STRENGTH_COLOR directly, so the "is this
 * really rehab" fact can't drift between call sites (see docs/DUPLICATION.md).
 */
export function strengthColor(session: { type: string; achillesAttached?: boolean }): TypeColor {
  return session.type === "achilles" || session.achillesAttached ? REHAB_COLOR : STRENGTH_COLOR;
}

// Base label for a plain (rehab-eligible) strength type, ignoring the stored
// DB title — used only for the two rehab cases below, never for a custom
// workout (achillesAttached is only ever true on an autoScheduled session,
// see schedule.ts's reconcile pass, so a hand-named custom workout's title
// is never at risk of being overridden here).
const STRENGTH_BASE_LABEL: Record<string, string> = {
  upper: "Upper",
  lower: "Lower",
  full_body: "Full Body",
};

/**
 * A strength session's display label, resolved from `type` /
 * `achillesAttached` rather than trusted off the stored `title` string.
 * Titles are baked onto the row at generation time (see program.ts
 * SESSION_TEMPLATES) — renaming a template only changes sessions created
 * afterwards, so an old row can still carry "Achilles · Kraft" in the DB
 * forever. Deriving the label from the same fact the colour uses keeps old
 * and new rows reading identically instead of the stored string being a
 * second, driftable source of truth (see docs/DUPLICATION.md).
 */
export function strengthSessionLabel(session: {
  type: string;
  title: string;
  achillesAttached?: boolean;
}): string {
  if (session.type === "achilles") return "Rehab";
  if (session.achillesAttached) {
    const base = STRENGTH_BASE_LABEL[session.type] ?? session.title;
    return `${base} + Rehab`;
  }
  return session.title;
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
  achilles: "var(--vi-rehab)",
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
