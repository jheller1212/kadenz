// ── Fuelling guidance ─────────────────────────────────────────────────────────
// Simple, conservative carbohydrate + hydration guidance for longer efforts,
// based on session duration (the biggest driver). Not medical advice — general
// endurance practice. Weight-agnostic by design so it works before we ask for
// body weight.

export interface FuelingAdvice {
  durationMinutes: number;
  /** Grams of carbohydrate per hour to aim for (0 = not needed). */
  carbsPerHour: number;
  /** Rough total carbs across the session. */
  totalCarbsG: number;
  /** Millilitres of fluid per hour. */
  hydrationMlPerHour: number;
  /** Short, plain-language tips. */
  tips: string[];
  /** True for race day — surface a pre-race checklist. */
  showChecklist: boolean;
}

/**
 * Fuelling advice for a session, or null when it's too short to bother with a
 * plan (under ~45 min, where water is plenty).
 */
export function fuelingAdvice(durationMinutes: number, type: string): FuelingAdvice | null {
  const d = Math.round(durationMinutes);
  if (d < 45) return null;

  // Carbs/hour rises with duration (glycogen depletion + absorption limits).
  let carbsPerHour: number;
  if (d >= 150) carbsPerHour = 90;
  else if (d >= 90) carbsPerHour = 60;
  else if (d >= 60) carbsPerHour = 30;
  else carbsPerHour = 0; // 45–60 min: optional

  const hours = d / 60;
  const totalCarbsG = Math.round(carbsPerHour * hours);
  const hydrationMlPerHour = d >= 90 ? 600 : 500;

  const tips: string[] = [];
  if (carbsPerHour === 0) {
    tips.push("Water is usually enough at this length — fuel only if you feel low.");
  } else {
    tips.push(`Aim for about ${carbsPerHour} g of carbs per hour (gels, chews, or a sports drink).`);
  }
  tips.push(`Sip ~${hydrationMlPerHour} ml of fluid per hour — more in the heat.`);
  if (d >= 120) {
    tips.push("Start fuelling early — in the first 30–45 min, don't wait until you're empty.");
  }

  const showChecklist = type === "race";
  if (showChecklist) {
    tips.push("Nothing new on race day — only gels and foods you've practised in training.");
  }

  return { durationMinutes: d, carbsPerHour, totalCarbsG, hydrationMlPerHour, tips, showChecklist };
}

/** Whether a workout is worth showing a fuelling card for. */
export function shouldShowFueling(type: string, durationMinutes: number | null | undefined): boolean {
  return type === "race" || type === "long" || (durationMinutes ?? 0) >= 90;
}
