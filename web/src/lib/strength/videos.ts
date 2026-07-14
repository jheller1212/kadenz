// Short YouTube form-demo videos per exercise slug (each verified live via
// the oEmbed endpoint at authoring time, 2026-07-13). Shown in a non-blocking
// sheet — session timers keep running while the video plays.

export const EXERCISE_VIDEOS: Record<string, string> = {
  overhead_press: "bj53-0DYKFo", // Born Fitness
  bent_over_row: "2MW94NxnGik", // OriGym
  floor_press: "qHCI9rK7HqM", // Live Lean TV
  renegade_row: "ZMW_vIWH5D8", // Coach Nick Fitness
  curl_to_press: "l6ApagwH0TY", // BuiltLean
  one_arm_row: "pYcpY20QaE8", // ScottHermanFitness
  lateral_raise: "3VcKaXpzqRo", // ScottHermanFitness
  db_squat: "v_c67Omje48", // Bodybuilding.com
  romanian_deadlift: "aa57T45iFSE", // NASM
  bulgarian_split_squat: "bZD05-6_yH4", // Live Lean TV
  single_leg_rdl: "iS7atZhcRnw", // Dr. Jacob Goodin
  single_leg_hip_thrust: "GoqoWSAiOsA", // Ashley Borden Fitness
  explosive_box_step_up: "-aYZMcgrxYA", // Movement As Medicine
  loaded_toe_walk: "wVb-RsmNH0Y", // OriGym
  straight_knee_calf_raise: "0RM9Gsz0dIE", // Sport Rehab Guide (Achilles HSR)
  bent_knee_calf_raise: "KoZ9x7TjXHc", // Lifelong Endurance (soleus)
  goblet_squat: "MeIiIdhvXT4", // ScottHermanFitness
  glute_bridge: "KjoL5FXJGQE", // Red Dot Fitness
  // Extended library (verified 2026-07-14)
  db_floor_fly: "bgC53-J-6gA", // PureGym
  push_up: "WDIpL0pjun0", // NASM
  bicep_curl: "ykJmrZ5v0Oo", // Howcast
  hammer_curl: "zC3nLlEvin4", // ScottHermanFitness
  overhead_triceps_extension: "-Vyt2QdsR7E", // ScottHermanFitness
  triceps_kickback: "6SS6K3lAwZ8", // ScottHermanFitness
  front_raise: "-t7fuZ0KhDA", // ScottHermanFitness
  rear_delt_fly: "4Xr7bKE_fxE", // Buff Dudes
  arnold_press: "ZsVxV2dV5YU", // Live Lean TV
  db_pullover: "qALakTR1nRI", // Onnit Academy
  db_shrug: "cJRVVxmytaM", // ScottHermanFitness
  reverse_lunge: "sjlsISvHyZs", // ScottHermanFitness
  sumo_squat: "GG92d1QZTZg", // T-Nation
  russian_twist: "FShbaqrGGu4", // Leap Fitness
  weighted_situp: "kZvSaq192cg", // LIVESTRONG
};

export function getVideoId(slug: string): string | null {
  return EXERCISE_VIDEOS[slug] ?? null;
}
