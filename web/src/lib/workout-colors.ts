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
