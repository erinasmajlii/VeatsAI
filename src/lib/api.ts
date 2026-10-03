import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AIAnalysisError } from "./ai/analyze";
import { ENVIRONMENTS, INSTALLATION_METHODS, STARTING_METHODS } from "./ai/schema";
import { InsufficientDataError } from "./engineering/calculate";
import { ServiceError } from "./projects/service";

/** Uniform JSON error handling for route handlers — one failing module never crashes the app. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 422 });
    }
    if (err instanceof AIAnalysisError) return NextResponse.json({ error: err.message, detail: err.detail, fallback_available: true }, { status: 502 });
    if (err instanceof InsufficientDataError) return NextResponse.json({ error: "Insufficient engineering data.", missing: err.missing }, { status: 422 });
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const nullableNum = (min: number, max: number) =>
  z.union([z.literal(""), z.null(), z.coerce.number().min(min).max(max)]).transform((v) => (v === "" ? null : v));

/** Engineer / user edits to engine inputs. Every field is validated for engineering plausibility. */
export const InputPatchSchema = z
  .object({
    motors: z.array(z.object({ quantity: z.coerce.number().int().min(1).max(50), power_kw: num(0.1, 500), label: z.string().max(40).nullish() })).min(1).max(20),
    voltage: nullableNum(100, 1000),
    frequency: z.coerce.number().refine((v) => v === 50 || v === 60, "Frequency must be 50 or 60 Hz"),
    phases: z.coerce.number().refine((v) => v === 3, "MVP engine supports three-phase motors only"),
    power_factor: num(0.5, 1),
    efficiency: num(0.5, 1),
    starting_method: z.enum(STARTING_METHODS).nullable(),
    cable_length_m: nullableNum(1, 2000),
    environment: z.enum(ENVIRONMENTS).nullable(),
    installation_method: z.enum(INSTALLATION_METHODS).nullable(),
    ambient_temperature_c: nullableNum(-40, 70),
    short_circuit_current_ka: nullableNum(0.1, 200),
    max_voltage_drop_pct: num(0.5, 15),
  })
  .partial();

export const ReviewActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update_inputs"), patch: InputPatchSchema }),
  z.object({
    type: z.literal("bom_override"),
    line_id: z.string(),
    override: z
      .object({
        sku: z.string().nullish(),
        quantity: z.coerce.number().min(0).max(100000).optional(),
        unit_price: z.coerce.number().min(0).max(1_000_000).optional(),
        removed: z.boolean().optional(),
      })
      .nullable(),
  }),
  z.object({ type: z.literal("add_line"), sku: z.string(), quantity: z.coerce.number().min(1).max(100000) }),
  z.object({
    type: z.literal("cost_settings"),
    settings: z.object({
      margin_pct: z.coerce.number().min(0).max(100).optional(),
      labor_rate_eur_h: z.coerce.number().min(0).max(1000).optional(),
      engineering_rate_eur_h: z.coerce.number().min(0).max(1000).optional(),
      labor_hours: z.coerce.number().min(0).max(10000).nullable().optional(),
      engineering_hours: z.coerce.number().min(0).max(10000).nullable().optional(),
    }),
  }),
  z.object({ type: z.literal("ack_warning"), warning_id: z.string(), acknowledged: z.boolean() }),
  z.object({ type: z.literal("add_note"), text: z.string().max(2000) }),
  z.object({ type: z.literal("request_changes"), reason: z.string().max(2000) }),
  z.object({ type: z.literal("approve") }),
  z.object({ type: z.literal("update_meta"), title: z.string().max(200).optional(), client_name: z.string().max(200).optional() }),
]);
