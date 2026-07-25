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
  easy: { solid: "#4ADE80", grad: "linear-gradient(135deg, #63E88F 0%, #34C46B 100%)" },
  recovery: { solid: "#4ADE80", grad: "linear-gradient(135deg, #63E88F 0%, #34C46B 100%)" },
  tempo: { solid: "#FFE14D", grad: "linear-gradient(135deg, #FFEB7A 0%, #F5CE12 100%)" },
  interval: { solid: "#FF4D4D", grad: "linear-gradient(135deg, #FF6E6E 0%, #E02424 100%)" },
  long: { solid: "#C084FC", grad: "linear-gradient(135deg, #CE9CFD 0%, #A855F7 100%)" },
  race: { solid: "#FF5A3C", grad: "linear-gradient(135deg, #FF7A60 0%, #E5401F 100%)" },
};

export const STRENGTH_COLOR: TypeColor = {
  solid: "#60A5FA",
  grad: "linear-gradient(135deg, #7FB8FB 0%, #3B82F6 100%)",
};

export function workoutColor(type: string): TypeColor {
  return WORKOUT_COLORS[type] ?? { solid: "#94A3B8", grad: "linear-gradient(135deg, #A8B3C1, #7C8794)" };
}
