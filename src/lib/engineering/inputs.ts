import type { DesignInputs, Provenance, RequestAnalysis, StandardFamily, TracedValue } from "../types";
import { DEFAULTS } from "./constants";

/** Fields without which the engine must not run (status MISSING_INFORMATION). */
export const CRITICAL_FIELDS = ["motors", "voltage", "starting_method"] as const;

/** Fields the engine can run without, but which produce warnings / "Insufficient data". */
export const RECOMMENDED_FIELDS = [
  "cable_length_m",
  "environment",
  "installation_method",
  "ambient_temperature_c",
  "short_circuit_current_ka",
] as const;

export const FIELD_LABEL: Record<string, string> = {
  motors: "Motor power & quantity",
  voltage: "Supply voltage",
  starting_method: "Starting method",
  cable_length_m: "Motor cable length",
  environment: "Installation environment (for IP rating)",
  installation_method: "Cable installation method",
  ambient_temperature_c: "Ambient temperature",
  short_circuit_current_ka: "Prospective short-circuit current",
  frequency: "Frequency",
};

function traced<T>(value: T, provenance: Provenance, note?: string): TracedValue<T> {
  return { value, provenance, ...(note ? { note } : {}) };
}

/**
 * Deterministic check of what is missing — we do not rely solely on the LLM's own list.
 * Returns critical and recommended missing field keys.
 */
export function findMissing(a: Pick<RequestAnalysis, "motors" | "voltage" | "starting_method" | (typeof RECOMMENDED_FIELDS)[number]>) {
  const critical: string[] = [];
  const recommended: string[] = [];
  if (!a.motors?.length || a.motors.some((m) => !(m.power_kw > 0) || !(m.quantity > 0))) critical.push("motors");
  if (!a.voltage) critical.push("voltage");
  if (!a.starting_method) critical.push("starting_method");
  for (const f of RECOMMENDED_FIELDS) if (a[f] === null || a[f] === undefined) recommended.push(f);
  return { critical, recommended };
}

/** Build engine inputs from the (validated) AI analysis. Defaults are explicit and labelled "Assumed value". */
export function buildDesignInputs(a: RequestAnalysis, standard: StandardFamily): DesignInputs {
  const src: Provenance = a.source === "ai" ? "AI_GENERATED" : "USER_PROVIDED";
  const opt = <T>(v: T | null) => (v === null || v === undefined ? traced<T | null>(null, "ASSUMED_VALUE", "Not provided") : traced<T | null>(v, src));
  return {
    standard,
    motors: a.motors.map((m, i) => ({ ...m, label: m.label || `M${i + 1}` })),
    voltage: opt(a.voltage),
    frequency: a.frequency ? traced(a.frequency, src) : traced(DEFAULTS.frequency_hz, "ASSUMED_VALUE", "Assumed value — typical for IEC regions"),
    phases: a.phases ? traced(a.phases, src) : traced(DEFAULTS.phases, "ASSUMED_VALUE", "Assumed value — three-phase motors"),
    power_factor: traced(DEFAULTS.power_factor, "ASSUMED_VALUE", "Assumed value — replace with motor nameplate"),
    efficiency: traced(DEFAULTS.efficiency, "ASSUMED_VALUE", "Assumed value — replace with motor nameplate"),
    starting_method: opt(a.starting_method),
    cable_length_m: opt(a.cable_length_m),
    environment: opt(a.environment),
    installation_method: opt(a.installation_method),
    ambient_temperature_c: opt(a.ambient_temperature_c),
    short_circuit_current_ka: opt(a.short_circuit_current_ka),
    max_voltage_drop_pct: traced(DEFAULTS.max_voltage_drop_pct, "ASSUMED_VALUE", "Project limit — configurable"),
  };
}

/** Apply engineer edits to inputs. Edited values are marked ENGINEER_OVERRIDE (or USER_PROVIDED when filling missing info). */
export function applyInputPatch(
  inputs: DesignInputs,
  patch: Partial<Record<keyof DesignInputs, unknown>>,
  provenance: Provenance = "ENGINEER_OVERRIDE",
): DesignInputs {
  const next: DesignInputs = structuredClone(inputs);
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    if (key === "motors") {
      next.motors = (raw as DesignInputs["motors"]).map((m, i) => ({
        quantity: Math.max(1, Math.round(Number(m.quantity))),
        power_kw: Number(m.power_kw),
        label: m.label || `M${i + 1}`,
      }));
      continue;
    }
    if (key === "standard") {
      next.standard = raw as StandardFamily;
      continue;
    }
    const k = key as Exclude<keyof DesignInputs, "motors" | "standard">;
    const value = raw === "" ? null : raw;
    (next[k] as TracedValue<unknown>) = { value, provenance };
  }
  return next;
}
