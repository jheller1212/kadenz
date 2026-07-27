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
  // Coverage sweep (verified 2026-07-27) — every remaining catalogue slug that
  // had no video, filled in one pass. Each id was checked two ways: yt-dlp
  // search + duration (android client) to confirm it's short-form, and the
  // YouTube oEmbed endpoint to confirm the id resolves and the title/channel
  // match the exercise. See videos.test.ts for the guard that keeps this in
  // sync with EXERCISES going forward.
  air_squat: "a_fb6Kz7FQg", // CrossFit
  assisted_pull_up: "AsUBri1uYzo", // josh cowan
  band_assisted_pull_up: "B_VkNQS5YLs", // NASM
  band_clamshell: "m_ZPapmqeNM", // Openfit on BODi
  band_deadlift: "obM6SBVa-MU", // YuryFit
  band_external_rotation: "_UvmPNGtlPM", // AskDoctorJo
  band_glute_bridge: "p7cFEtMC68g", // ChiroUp
  band_lateral_walk: "M5uxEQH5BUM", // NASM
  band_pull_apart: "smSSXITNpCI", // Rogue Fitness
  band_row: "FDCEXPBI1F0", // Born Fitness
  band_squat: "Eaqr79zvqIw", // Live Lean TV
  band_squat_to_press: "s7UH5cFm9cM", // Fit To Hunt
  barbell_back_squat: "-bJIpOq-LWk", // NASM
  barbell_bench_press: "CayG6UYqL8g", // NASM
  barbell_bulgarian_split_squat: "ZpfUdHtFGcM", // Optimum Whealth
  barbell_floor_press: "YwLjxqEYg0w", // OPEX Fitness
  barbell_hip_thrust_with_bench: "vGqkX4jsivI", // Laura Glisson NASM-CPT
  barbell_reverse_lunge: "KZaCvzd5dQM", // Show Up Fitness
  barbell_row: "bm0_q9bR_HA", // NASM
  barbell_shoulder_press: "cGnhixvC8uA", // NASM
  // closest verified match for "straight-leg deadlift" — same near-locked-knee
  // hip hinge as a stiff-leg deadlift, no barbell-specific short video found
  barbell_straight_leg_deadlift: "CN_7cz3P-1U", // Renaissance Periodization
  cable_fly: "XNf6TBErGys", // NASM
  cable_row: "0R9ZQd3aM6s", // NASM
  calf_raise_machine: "SVqpe2df9Dc", // Sarah Malone
  chest_press_machine: "lRo9zZ7EwpM", // NASM
  chin_up: "qVztO-F-IwI", // Nuffield Health
  clamshell: "oHjBwnfpcQs", // Live Lean TV
  dumbbell_bench_press: "4_QuyfOCI5U", // NASM
  face_pull: "eTCBSFlCJ_s", // NASM
  farmers_carry: "8OtwXwrJizk", // PureGym
  hip_abduction_machine: "xhz9HM9ZAlA", // Rachael Toohey
  hip_adduction_machine: "sJ5Sup90Tws", // Never Been Stronger
  hip_raise: "RR0oZhhUVWo", // Heartmybody Fitness
  kettlebell_deadlift: "LnIMaf-XOpM", // NASM
  kettlebell_row: "l5qelXL5nfs", // OPEX Fitness
  kettlebell_squat: "MWHIs0zxkCU", // NASM
  kettlebell_swing: "KKumMhxKapw", // NASM
  lat_pulldown_machine: "JGeRYIZdojU", // PureGym
  leg_curl_machine: "G5iP_YcDQdE", // NASM
  leg_extension_machine: "4ZDm5EbiFI8", // PureGym
  leg_press_machine: "cDGOn-yfKJA", // NASM
  nordic_curl_negative: "ogeV4-tyhjs", // Luke Amaral
  pike_push_up: "2b5t0Cu2nQI", // NASM
  pull_up: "9yVGh3XbJ34", // NASM
  seated_row_machine: "k0cTJCfxa0Y", // NASM
  shoulder_press_machine: "GcY6TZxfS0k", // PureGym
  side_lying_leg_raise: "DA4FVJH2PnU", // The Active Life
  single_leg_calf_raise: "qPd73snQfUs", // Hospital for Special Surgery
  single_leg_glute_bridge: "sVfp4LN9niA", // PureGym
  standing_calf_raise: "qacGi_xmXxg", // Asphodel Fitness
  step_down: "B3CjUyMouBA", // E3 Rehab Exercise Library
  superman_from_floor: "LZoWdePF1NQ", // Live Lean TV
  tibialis_raise: "lBCRdjdWiTI", // Balance In Motion
  triceps_pushdown: "J65T1pUTsRc", // Ethan Salm
  wall_sit: "cWTZ8Am1Ee0", // MedBridge
};

export function getVideoId(slug: string): string | null {
  return EXERCISE_VIDEOS[slug] ?? null;
}
