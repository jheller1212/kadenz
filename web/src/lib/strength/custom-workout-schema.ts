import { z } from "zod";
import { EXERCISES } from "./program";

// Shared request validation for the custom-workout routes.

export const CustomSlotSchema = z
  .object({
    exerciseSlug: z
      .string()
      .refine((slug) => EXERCISES.some((e) => e.slug === slug), {
        message: "Unknown exercise",
      }),
    sets: z.number().int().min(1).max(20),
    repLow: z.number().int().min(1).max(100),
    repHigh: z.number().int().min(1).max(100),
    weightKg: z.number().min(0).max(500).optional(),
    restSeconds: z.number().int().min(0).max(600),
  })
  .refine((s) => s.repLow <= s.repHigh, {
    message: "repLow must be <= repHigh",
  });

export const CustomWorkoutBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slots: z.array(CustomSlotSchema).min(1).max(30),
});

export const UuidSchema = z.string().uuid();
