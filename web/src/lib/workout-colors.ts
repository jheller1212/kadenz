// Benchmark-parity workout type palette. Single source of truth for JS call
// sites; CSS twins live in globals.css as --k-type-* / --k-type-*-grad.

export interface TypeColor {
  solid: string;
  grad: string;
}

export const WORKOUT_COLORS: Record<string, TypeColor> = {
  easy: { solid: "#7BC232", grad: "linear-gradient(135deg, #C3D82E 0%, #5CB531 100%)" },
  recovery: { solid: "#7BC232", grad: "linear-gradient(135deg, #C3D82E 0%, #5CB531 100%)" },
  tempo: { solid: "#F2A113", grad: "linear-gradient(135deg, #F7B32B 0%, #ED8B00 100%)" },
  interval: { solid: "#E0402E", grad: "linear-gradient(135deg, #F0562E 0%, #C62828 100%)" },
  long: { solid: "#8655F0", grad: "linear-gradient(135deg, #9B6BF3 0%, #7C3AED 100%)" },
  race: { solid: "#FF4D4D", grad: "linear-gradient(135deg, #FF6B5E 0%, #D32F2F 100%)" },
};

export const STRENGTH_COLOR: TypeColor = {
  solid: "#3B82F6",
  grad: "linear-gradient(135deg, #60A5FA 0%, #2563EB 100%)",
};

export function workoutColor(type: string): TypeColor {
  return WORKOUT_COLORS[type] ?? { solid: "#94A3B8", grad: "linear-gradient(135deg, #A8B3C1, #7C8794)" };
}
