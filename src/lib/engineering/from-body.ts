import { z } from "zod";
import { InputPatchSchema } from "../api";
import type { RequestAnalysis } from "../types";
import { applyInputPatch, buildDesignInputs } from "./inputs";

const EMPTY: RequestAnalysis = {
  project_type: "motor_control_panel", project_title: "", client_name: null, motors: [], voltage: null, frequency: null, phases: null,
  starting_method: null, cable_length_m: null, environment: null, installation_method: null, ambient_temperature_c: null,
  short_circuit_current_ka: null, standards: [], notes: [], missing_information: [], source: "rule_based_fallback",
};

/** Build engine inputs from a raw API body `{ inputs: {...} }` (validated). Unspecified values use visible defaults. */
export function inputsFromBody(body: unknown) {
  const patch = z.object({ inputs: InputPatchSchema }).parse(body).inputs;
  return applyInputPatch(buildDesignInputs(EMPTY, "IEC"), patch, "USER_PROVIDED");
}
