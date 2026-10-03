import { getRule } from "../standards";
import type {
  DesignInputs,
  EngineeringCalculation,
  EngineeringResult,
  EngineeringWarning,
  InstallationMethod,
  MotorCircuitResult,
  StartingMethod,
} from "../types";
import {
  AMBIENT_CORRECTION_PVC,
  AMPACITY_TABLE_A,
  ASSUMED_INSTALLATION,
  CONDUCTOR_SIZES_MM2,
  DEFAULTS,
  ENVIRONMENT_LABEL,
  ENVIRONMENT_MIN_IP,
  INSTALLATION_LABEL,
  STANDARD_RATINGS_A,
  STARTING_METHOD_LABEL,
  STARTING_MULTIPLIER,
} from "./constants";
import { findMissing } from "./inputs";

/**
 * Engineering Engine — deterministic calculations. No LLM is involved here.
 * Every result carries its formula, reason, rule id and standard references.
 */

export class InsufficientDataError extends Error {
  constructor(public missing: string[]) {
    super(`Insufficient engineering data: ${missing.join(", ")}`);
  }
}

const SQRT3 = Math.sqrt(3);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** I = P / (√3 × V × PF × η) */
export function motorCurrent(powerKw: number, voltage: number, pf: number, eff: number): number {
  return (powerKw * 1000) / (SQRT3 * voltage * pf * eff);
}

export function nextStandardRating(current: number): number {
  return STANDARD_RATINGS_A.find((r) => r >= current) ?? STANDARD_RATINGS_A[STANDARD_RATINGS_A.length - 1];
}

export function ambientFactor(tempC: number): number {
  let factor = AMBIENT_CORRECTION_PVC[0][1];
  for (const [t, f] of AMBIENT_CORRECTION_PVC) if (tempC >= t) factor = f;
  return factor;
}

/** ΔU% = √3 × I × L × (ρ / S) × cosφ / U × 100 (reactance neglected) */
export function voltageDropPct(current: number, lengthM: number, csa: number, pf: number, voltage: number): number {
  return ((SQRT3 * current * lengthM * (DEFAULTS.copper_resistivity_ohm_mm2_per_m / csa) * pf) / voltage) * 100;
}

/** Smallest standard CSA with corrected ampacity ≥ required current and (if length known) ΔU within limit. */
export function selectCable(opts: {
  requiredA: number;
  designA: number;
  method: InstallationMethod;
  correction: number;
  lengthM: number | null;
  pf: number;
  voltage: number;
  maxDropPct: number;
}): { csa: number; ampacity: number; drop: number | null; limitedBy: "ampacity" | "voltage_drop" } | null {
  const table = AMPACITY_TABLE_A[opts.method];
  for (const csa of CONDUCTOR_SIZES_MM2) {
    const iz = table[csa] * opts.correction;
    if (iz < opts.requiredA) continue;
    const drop = opts.lengthM ? voltageDropPct(opts.designA, opts.lengthM, csa, opts.pf, opts.voltage) : null;
    if (drop !== null && drop > opts.maxDropPct) continue;
    const ampacityOnly = CONDUCTOR_SIZES_MM2.find((s) => table[s] * opts.correction >= opts.requiredA);
    return { csa, ampacity: round(iz), drop: drop === null ? null : round(drop, 2), limitedBy: ampacityOnly === csa ? "ampacity" : "voltage_drop" };
  }
  return null;
}

export function calculateDesign(inputs: DesignInputs): EngineeringCalculation {
  const missing = findMissing({
    motors: inputs.motors,
    voltage: inputs.voltage.value,
    starting_method: inputs.starting_method.value,
    cable_length_m: inputs.cable_length_m.value,
    environment: inputs.environment.value,
    installation_method: inputs.installation_method.value,
    ambient_temperature_c: inputs.ambient_temperature_c.value,
    short_circuit_current_ka: inputs.short_circuit_current_ka.value,
  });
  if (missing.critical.length) throw new InsufficientDataError(missing.critical);

  const V = inputs.voltage.value as number;
  const pf = inputs.power_factor.value;
  const eff = inputs.efficiency.value;
  const method = inputs.starting_method.value as StartingMethod;
  const lengthM = inputs.cable_length_m.value;
  const install = inputs.installation_method.value ?? ASSUMED_INSTALLATION;
  const ambient = inputs.ambient_temperature_c.value ?? DEFAULTS.ambient_temperature_c;
  const kAmb = ambientFactor(ambient);
  const maxDrop = inputs.max_voltage_drop_pct.value;

  if (!(V > 0) || !(pf > 0 && pf <= 1) || !(eff > 0 && eff <= 1)) {
    throw new InsufficientDataError(["valid voltage / power factor / efficiency"]);
  }

  const results: EngineeringResult[] = [];
  const warnings: EngineeringWarning[] = [];
  const circuits: MotorCircuitResult[] = [];
  const reviewStatus = "REQUIRES_REVIEW" as const;

  // ---------------------------------------------------------------- per motor group
  inputs.motors.forEach((m, i) => {
    const label = m.label || `M${i + 1}`;
    const flc = motorCurrent(m.power_kw, V, pf, eff);
    const start = flc * STARTING_MULTIPLIER[method];
    // In Star-Delta the line & delta contactors, overload and the two motor cables carry phase current FLC/√3.
    const branchCurrent = method === "STAR_DELTA" ? flc / SQRT3 : flc;
    const protection = nextStandardRating(flc);
    const contactor = method === "STAR_DELTA" ? flc / SQRT3 : flc;
    const cable = selectCable({
      requiredA: method === "STAR_DELTA" ? branchCurrent : protection,
      designA: branchCurrent,
      method: install,
      correction: kAmb,
      lengthM,
      pf,
      voltage: V,
      maxDropPct: maxDrop,
    });

    circuits.push({
      motor_index: i,
      label,
      power_kw: m.power_kw,
      quantity: m.quantity,
      full_load_current_a: round(flc),
      starting_current_a: round(start),
      branch_protection_a: protection,
      contactor_ac3_a: round(contactor),
      overload_range_target_a: round(branchCurrent),
      cable_csa_mm2: cable?.csa ?? null,
      cable_ampacity_a: cable?.ampacity ?? null,
      voltage_drop_pct: cable?.drop ?? null,
    });

    const group = m.quantity > 1 ? ` (each of ${m.quantity} × ${m.power_kw} kW)` : ` (${m.power_kw} kW)`;
    const r = (id: string, ruleId: string, partial: Omit<EngineeringResult, "id" | "rule_id" | "standards" | "provenance" | "status"> & { status?: EngineeringResult["status"]; provenance?: EngineeringResult["provenance"] }) =>
      results.push({
        id: `${label}.${id}`,
        rule_id: ruleId,
        standards: getRule(ruleId).standard,
        provenance: partial.provenance ?? "ENGINEERING_CALCULATION",
        status: partial.status ?? reviewStatus,
        ...partial,
      });

    r("flc", "motor_full_load_current", {
      label: `${label} full-load current${group}`,
      value: `${round(flc)} A`, numeric: round(flc), unit: "A",
      formula: `I = ${m.power_kw * 1000} W / (√3 × ${V} V × ${pf} × ${eff}) = ${round(flc, 2)} A`,
      reason: `Three-phase motor current from rated power, voltage, PF and efficiency${inputs.power_factor.provenance === "ASSUMED_VALUE" || inputs.efficiency.provenance === "ASSUMED_VALUE" ? " (PF/η are assumed values)" : ""}.`,
    });
    r("start", "motor_starting_current", {
      label: `${label} starting current`,
      value: `≈ ${round(start)} A`, numeric: round(start), unit: "A",
      formula: `I_start ≈ ${STARTING_MULTIPLIER[method]} × ${round(flc)} A (${STARTING_METHOD_LABEL[method]})`,
      reason: "Typical multiplier for the selected starting method — confirm with motor/starter data.",
    });
    r("protection", "overcurrent_protection_coordination", {
      label: `${label} branch protection`,
      value: `${protection} A, 3P`, numeric: protection, unit: "A",
      formula: `In = next standard rating ≥ ${round(flc)} A → ${protection} A`,
      reason: `Calculated design current = ${round(flc)} A.${cable ? ` Cable Iz = ${cable.ampacity} A ≥ In ✓` : ""}`,
    });
    if (method !== "VFD") {
      r("contactor", "contactor_ac3_selection", {
        label: `${label} contactor (AC-3)`,
        value: method === "STAR_DELTA" ? `3 × ≥ ${round(contactor)} A AC-3` : `≥ ${round(contactor)} A AC-3`,
        numeric: round(contactor), unit: "A",
        formula: method === "STAR_DELTA" ? `I_AC3 ≥ FLC / √3 = ${round(contactor)} A (line & delta)` : `I_AC3 ≥ FLC = ${round(contactor)} A`,
        reason: `Utilization category AC-3 at ${V} V.`,
      });
      r("overload", "overload_setting", {
        label: `${label} overload setting`,
        value: `${round(branchCurrent)} A`, numeric: round(branchCurrent), unit: "A",
        formula: method === "STAR_DELTA" ? `Ir = FLC / √3 = ${round(branchCurrent)} A` : `Ir = FLC = ${round(branchCurrent)} A`,
        reason: "Overload device range must include this setting.",
      });
    }
    if (cable) {
      r("cable", "cable_current_capacity", {
        label: `${label} motor cable`,
        value: `${method === "STAR_DELTA" ? "2 × " : ""}${cable.csa} mm² Cu`, numeric: cable.csa, unit: "mm²",
        formula: `Iz = ${AMPACITY_TABLE_A[install][cable.csa]} A × k_amb ${kAmb} = ${cable.ampacity} A ≥ ${round(method === "STAR_DELTA" ? branchCurrent : protection)} A`,
        reason: `${INSTALLATION_LABEL[install]}${inputs.installation_method.value ? "" : " (assumed reference installation)"}, ambient ${ambient} °C. ${cable.limitedBy === "voltage_drop" ? "Size increased to meet voltage-drop limit." : "Sized on current-carrying capacity."}`,
        provenance: inputs.installation_method.value ? "ENGINEERING_CALCULATION" : "ASSUMED_VALUE",
      });
    } else {
      warnings.push({ id: `${label}.cable_none`, severity: "critical", message: `${label}: no standard conductor size up to 120 mm² satisfies ampacity / voltage drop. Insufficient data or out of MVP range.`, rule_id: "cable_current_capacity", standards: ["IEC 60364"] });
    }
    r("vdrop", "voltage_drop", lengthM && cable
      ? {
          label: `${label} voltage drop`,
          value: `${cable.drop} %`, numeric: cable.drop ?? undefined, unit: "%",
          formula: `ΔU = √3 × ${round(branchCurrent)} A × ${lengthM} m × (${DEFAULTS.copper_resistivity_ohm_mm2_per_m}/${cable.csa}) × ${pf} / ${V} V`,
          reason: `Limit ${maxDrop} % (${(cable.drop ?? 0) <= maxDrop ? "within limit" : "exceeds limit"}).`,
        }
      : {
          label: `${label} voltage drop`, value: "Insufficient data", reason: "Cable length not provided — voltage drop cannot be calculated.",
          status: "INSUFFICIENT_DATA",
        });

    // Deterministic check: C-curve MCB magnetic threshold vs. DOL inrush.
    if (method === "DOL" && start > 5 * protection) {
      warnings.push({
        id: `${label}.inrush_curve`, severity: "warning", rule_id: "overcurrent_protection_coordination", standards: ["IEC 60947"],
        message: `${label}: DOL starting current ≈ ${round(start)} A exceeds 5 × In (${5 * protection} A). A C-curve MCB may trip on start — use a motor-rated device (MPCB / D-curve / motor-protection MCCB). Verify with manufacturer data.`,
      });
    }
    if (cable?.drop != null && cable.drop > maxDrop) {
      warnings.push({ id: `${label}.vdrop`, severity: "warning", rule_id: "voltage_drop", standards: ["IEC 60364"], message: `${label}: voltage drop ${cable.drop} % exceeds project limit ${maxDrop} %.` });
    }
  });

  // ---------------------------------------------------------------- main incomer
  const total = circuits.reduce((s, c) => s + c.full_load_current_a * c.quantity, 0);
  const design = total * DEFAULTS.diversity_factor;
  const main = nextStandardRating(design);
  results.unshift(
    {
      id: "total_current", label: "Total connected current", value: `${round(total)} A`, numeric: round(total), unit: "A",
      formula: circuits.map((c) => `${c.quantity} × ${c.full_load_current_a} A`).join(" + ") + ` = ${round(total)} A`,
      reason: "Sum of motor full-load currents.", rule_id: "main_incomer_selection", standards: getRule("main_incomer_selection").standard,
      provenance: "ENGINEERING_CALCULATION", status: reviewStatus,
    },
    {
      id: "main_breaker", label: "Main incoming breaker", value: `${main} A, 3P`, numeric: main, unit: "A",
      formula: `In ≥ ΣI × diversity ${DEFAULTS.diversity_factor} = ${round(design)} A → ${main} A`,
      reason: `Calculated design current = ${round(design)} A. Diversity factor 1.0 (assumed, no simultaneity reduction).`,
      rule_id: "main_incomer_selection", standards: getRule("main_incomer_selection").standard,
      provenance: "ENGINEERING_CALCULATION", status: reviewStatus,
    },
  );

  // ---------------------------------------------------------------- enclosure IP
  const env = inputs.environment.value;
  const ip = env ? ENVIRONMENT_MIN_IP[env] : null;
  results.push(
    env
      ? {
          id: "enclosure_ip", label: "Enclosure minimum IP rating", value: `${ip}`, reason: `Environment: ${ENVIRONMENT_LABEL[env]}.`,
          rule_id: "enclosure_ip_rating", standards: ["IEC 60529"], provenance: "STANDARDS_RULE", status: reviewStatus,
        }
      : {
          id: "enclosure_ip", label: "Enclosure minimum IP rating", value: "Insufficient data", reason: "IP rating requires environmental specification.",
          rule_id: "enclosure_ip_rating", standards: ["IEC 60529"], provenance: "STANDARDS_RULE", status: "INSUFFICIENT_DATA",
        },
  );

  // ---------------------------------------------------------------- warnings
  if (!lengthM) warnings.push({ id: "missing.cable_length", severity: "warning", rule_id: "voltage_drop", standards: ["IEC 60364"], message: "Cable length not provided — voltage drop not calculated and motor cable quantity not included in BOM." });
  if (!inputs.installation_method.value) warnings.push({ id: "missing.installation_method", severity: "warning", rule_id: "cable_current_capacity", standards: ["IEC 60364"], message: `Installation method not provided — cable sized for assumed reference installation "${INSTALLATION_LABEL[ASSUMED_INSTALLATION]}".` });
  if (inputs.ambient_temperature_c.value == null) warnings.push({ id: "missing.ambient", severity: "info", rule_id: "cable_current_capacity", standards: ["IEC 60364"], message: `Ambient temperature not provided — ${DEFAULTS.ambient_temperature_c} °C reference assumed.` });
  if (!env) warnings.push({ id: "missing.environment", severity: "warning", rule_id: "enclosure_ip_rating", standards: ["IEC 60529"], message: "IP rating requires environmental specification — enclosure IP suitability not verified." });
  if (inputs.short_circuit_current_ka.value == null) {
    warnings.push({ id: "missing.isc", severity: "critical", rule_id: "breaking_capacity", standards: ["IEC 60364", "IEC 60947"], message: "Short-circuit current not provided — breaking capacity (Icu/Ics) of breakers not verified." });
  } else {
    warnings.push({ id: "isc.verify", severity: "warning", rule_id: "breaking_capacity", standards: ["IEC 60947"], message: `Prospective short-circuit current ${inputs.short_circuit_current_ka.value} kA — verify each device's breaking capacity against manufacturer data (not calculated by MVP).` });
  }
  if (inputs.power_factor.provenance === "ASSUMED_VALUE" || inputs.efficiency.provenance === "ASSUMED_VALUE") {
    warnings.push({ id: "assumed.pf_eff", severity: "info", rule_id: "motor_full_load_current", standards: ["IEC 60364"], message: `Power factor (${pf}) and efficiency (${eff}) are assumed values — replace with motor nameplate data.` });
  }
  warnings.push(
    { id: "review.breaker", severity: "warning", rule_id: "overcurrent_protection_coordination", standards: ["IEC 60364", "IEC 60947"], message: "Final breaker selection requires engineer verification (curve, selectivity, breaking capacity)." },
    { id: "review.assembly", severity: "warning", rule_id: "assembly_verification", standards: ["IEC 61439"], message: "Panel assembly design verification (temperature rise, short-circuit withstand) is not performed by VeatsAI." },
    { id: "review.estop", severity: "warning", rule_id: "emergency_stop", standards: ["IEC 60204-1"], message: "Emergency stop category and safety circuit must be defined from the machine risk assessment." },
  );

  return {
    inputs_snapshot: inputs,
    motor_circuits: circuits,
    total_current_a: round(total),
    main_breaker_a: main,
    results,
    warnings,
    required_ip_rating: ip,
  };
}
