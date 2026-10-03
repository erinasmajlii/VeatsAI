import { z } from "zod";

/**
 * Schemas for AI output.
 *
 * `AiExtractionSchema` is sent to the model as the structured-output format (kept simple:
 * nullable fields + enums). `validateExtraction` then applies stricter engineering
 * plausibility checks — we never trust LLM JSON blindly.
 */

export const STARTING_METHODS = ["DOL", "STAR_DELTA", "SOFT_STARTER", "VFD"] as const;
export const ENVIRONMENTS = ["indoor_clean", "indoor_dusty", "outdoor", "wet_washdown"] as const;
export const INSTALLATION_METHODS = ["conduit_on_wall", "cable_tray", "buried", "in_free_air"] as const;

export const AiExtractionSchema = z.object({
  project_type: z.enum(["motor_control_panel", "distribution_board", "other"]),
  project_title: z.string(),
  client_name: z.string().nullable(),
  motors: z.array(
    z.object({
      quantity: z.number(),
      power_kw: z.number(),
      label: z.string().nullable(),
    }),
  ),
  voltage: z.number().nullable(),
  frequency: z.number().nullable(),
  phases: z.number().nullable(),
  starting_method: z.enum(STARTING_METHODS).nullable(),
  cable_length_m: z.number().nullable(),
  environment: z.enum(ENVIRONMENTS).nullable(),
  installation_method: z.enum(INSTALLATION_METHODS).nullable(),
  ambient_temperature_c: z.number().nullable(),
  short_circuit_current_ka: z.number().nullable(),
  standards: z.array(z.string()),
  notes: z.array(z.string()),
  missing_information: z.array(z.string()),
});

export type AiExtraction = z.infer<typeof AiExtractionSchema>;

/** Engineering plausibility validation applied after parsing. */
export const ValidatedExtractionSchema = AiExtractionSchema.extend({
  motors: z
    .array(
      z.object({
        quantity: z.number().int().min(1).max(50),
        power_kw: z.number().gt(0).max(500),
        label: z.string().nullable(),
      }),
    )
    .max(20),
  voltage: z.number().min(100).max(1000).nullable(),
  frequency: z.union([z.literal(50), z.literal(60)]).nullable(),
  phases: z.union([z.literal(1), z.literal(3)]).nullable(),
  cable_length_m: z.number().gt(0).max(2000).nullable(),
  ambient_temperature_c: z.number().min(-40).max(70).nullable(),
  short_circuit_current_ka: z.number().gt(0).max(200).nullable(),
});

export function validateExtraction(data: unknown) {
  return ValidatedExtractionSchema.safeParse(data);
}
