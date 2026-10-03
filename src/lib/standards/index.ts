import type { StandardFamily, WarningSeverity } from "../types";

/**
 * Standards Engine.
 *
 * Holds the standards and engineering rules the Engineering Engine references.
 * Rules are data — they are not hard-coded in UI components. Each engineering result
 * points to a rule id, so every number in the UI can be traced back to its rule and standard.
 *
 * IMPORTANT: VeatsAI references these standards conceptually. It does not reproduce their text,
 * does not claim compliance, and does not implement every requirement. Editions are left
 * "configurable" unless a company explicitly configures one — we never invent edition/year.
 */

export interface StandardDefinition {
  standard: StandardFamily;
  code: string;
  title: string;
  topic: string;
  version: string;
  used_for: string[];
  implemented: boolean;
}

export interface StandardRule {
  id: string;
  name: string;
  standard: string[];
  family: StandardFamily;
  description: string;
  inputs: string[];
  severity: WarningSeverity;
  /** How the MVP engine applies the rule (plain-language, shown in UI). */
  implementation: string;
}

export interface StandardsFamilyInfo {
  family: StandardFamily;
  label: string;
  status: "implemented" | "not_implemented";
  note: string;
}

export const STANDARD_FAMILIES: StandardsFamilyInfo[] = [
  { family: "IEC", label: "IEC (International Electrotechnical Commission)", status: "implemented", note: "MVP rule set — preliminary, standards-referenced." },
  { family: "NEC", label: "NEC (NFPA 70)", status: "not_implemented", note: "Coming soon — no NEC rules are implemented. Selecting NEC is disabled." },
];

export const STANDARDS: StandardDefinition[] = [
  {
    standard: "IEC", code: "IEC 60364", title: "Low-voltage electrical installations",
    topic: "Wiring principles, protection, cable sizing, voltage drop, current-carrying capacity",
    version: "configurable",
    used_for: ["cable sizing considerations", "overcurrent protection coordination", "voltage drop", "current-carrying capacity", "installation conditions"],
    implemented: true,
  },
  {
    standard: "IEC", code: "IEC 60204-1", title: "Safety of machinery — Electrical equipment of machines",
    topic: "Machine electrical equipment, control circuits, protective measures, emergency stop",
    version: "configurable",
    used_for: ["control circuit context", "emergency stop function", "machine control panels"],
    implemented: true,
  },
  {
    standard: "IEC", code: "IEC 61439", title: "Low-voltage switchgear and controlgear assemblies",
    topic: "Panel / assembly design and design verification",
    version: "configurable",
    used_for: ["panel assembly", "enclosure / assembly verification responsibility"],
    implemented: true,
  },
  {
    standard: "IEC", code: "IEC 60947", title: "Low-voltage switchgear and controlgear",
    topic: "Circuit breakers, contactors, motor starters, switching and protection devices",
    version: "configurable",
    used_for: ["breaker selection", "contactor utilization category (AC-3)", "motor protection devices"],
    implemented: true,
  },
  {
    standard: "IEC", code: "IEC 60529", title: "Degrees of protection provided by enclosures (IP Code)",
    topic: "Enclosure IP rating",
    version: "configurable",
    used_for: ["enclosure IP requirement from environment"],
    implemented: true,
  },
  {
    standard: "IEC", code: "IEC 60228", title: "Conductors of insulated cables",
    topic: "Conductor nominal cross-sections and classes",
    version: "configurable",
    used_for: ["standard conductor size series"],
    implemented: true,
  },
  {
    standard: "IEC", code: "IEC 60332", title: "Tests on electric and optical fibre cables under fire conditions",
    topic: "Cable fire behaviour (metadata only)",
    version: "configurable",
    used_for: ["cable fire-performance metadata — no tests are performed by VeatsAI"],
    implemented: true,
  },
];

export const RULES: StandardRule[] = [
  {
    id: "motor_full_load_current", name: "Motor full-load current", family: "IEC",
    standard: ["IEC 60364", "IEC 60204-1"],
    description: "Design current of a three-phase motor circuit is derived from rated power, voltage, power factor and efficiency.",
    inputs: ["power_kw", "voltage", "power_factor", "efficiency"],
    severity: "info",
    implementation: "I = P / (√3 × V × PF × η). Nameplate current, when available, takes precedence and must be entered by the engineer.",
  },
  {
    id: "motor_starting_current", name: "Motor starting current", family: "IEC",
    standard: ["IEC 60947"],
    description: "Starting current depends on the starting method and must be considered when selecting protective devices.",
    inputs: ["full_load_current", "starting_method"],
    severity: "info",
    implementation: "Typical multipliers (configurable): DOL 7×, Star-Delta 2.5×, Soft starter 3.5×, VFD 1.2× of FLC.",
  },
  {
    id: "overcurrent_protection_coordination", name: "Protection selection (Ib ≤ In ≤ Iz)", family: "IEC",
    standard: ["IEC 60364", "IEC 60947"],
    description: "Protective device rating must be at least the design current and not exceed the cable's current-carrying capacity.",
    inputs: ["design_current", "cable_ampacity", "standard_ratings"],
    severity: "warning",
    implementation: "Next standard rating ≥ design current; verified against selected cable ampacity. Tripping curve vs. motor inrush must be verified by the engineer.",
  },
  {
    id: "main_incomer_selection", name: "Main incomer selection", family: "IEC",
    standard: ["IEC 60364", "IEC 60947", "IEC 61439"],
    description: "Main incoming device rated for the sum of connected motor currents (diversity factor 1.0 unless engineer specifies).",
    inputs: ["total_current", "diversity_factor", "standard_ratings"],
    severity: "warning",
    implementation: "Next standard rating ≥ ΣFLC × diversity (default 1.0).",
  },
  {
    id: "contactor_ac3_selection", name: "Contactor selection (AC-3)", family: "IEC",
    standard: ["IEC 60947"],
    description: "Motor contactors are selected by their AC-3 utilization-category rating at the operating voltage.",
    inputs: ["full_load_current", "starting_method", "voltage"],
    severity: "warning",
    implementation: "AC-3 rating ≥ FLC (DOL) or ≥ 0.58 × FLC per contactor (Star-Delta line/delta contactors).",
  },
  {
    id: "overload_setting", name: "Motor overload protection", family: "IEC",
    standard: ["IEC 60947", "IEC 60204-1"],
    description: "Overload relay / motor protection device setting range must include the motor full-load current.",
    inputs: ["full_load_current", "device_range"],
    severity: "critical",
    implementation: "Device range [min, max] must contain FLC (or 0.58 × FLC in the delta branch for Star-Delta).",
  },
  {
    id: "cable_current_capacity", name: "Cable current-carrying capacity", family: "IEC",
    standard: ["IEC 60364", "IEC 60228"],
    description: "Cable current carrying capacity must be checked against design current and installation conditions.",
    inputs: ["design_current", "cable_type", "installation_method", "ambient_temperature"],
    severity: "warning",
    implementation: "Indicative copper/PVC ampacity table (reference installation, 30 °C) with ambient correction; smallest IEC 60228 size with Iz ≥ In.",
  },
  {
    id: "voltage_drop", name: "Voltage drop", family: "IEC",
    standard: ["IEC 60364"],
    description: "Voltage drop from origin to load should be kept within the project limit.",
    inputs: ["design_current", "cable_length", "csa", "power_factor"],
    severity: "warning",
    implementation: "ΔU% = √3 × I × L × (ρ/S) × cosφ / U × 100 (reactance neglected). Project limit configurable (default 5 %).",
  },
  {
    id: "breaking_capacity", name: "Short-circuit breaking capacity", family: "IEC",
    standard: ["IEC 60364", "IEC 60947"],
    description: "Protective devices must have breaking capacity not less than the prospective short-circuit current at the point of installation.",
    inputs: ["short_circuit_current", "device_icu"],
    severity: "critical",
    implementation: "Not calculated by MVP — requires prospective short-circuit current and device data; flagged for engineer verification.",
  },
  {
    id: "enclosure_ip_rating", name: "Enclosure degree of protection", family: "IEC",
    standard: ["IEC 60529"],
    description: "Enclosure IP rating must suit the installation environment.",
    inputs: ["environment"],
    severity: "warning",
    implementation: "Environment → minimum IP mapping (configurable): indoor clean IP54, indoor dusty IP55, outdoor IP65, wet/washdown IP66. No environment → no IP rating is assumed.",
  },
  {
    id: "assembly_verification", name: "Panel assembly verification", family: "IEC",
    standard: ["IEC 61439"],
    description: "A switchgear/controlgear assembly requires design verification (e.g. temperature rise, short-circuit withstand) by the assembly manufacturer.",
    inputs: ["enclosure", "components", "heat_dissipation"],
    severity: "warning",
    implementation: "Not performed by MVP — flagged as engineer/panel-builder responsibility.",
  },
  {
    id: "emergency_stop", name: "Emergency stop function", family: "IEC",
    standard: ["IEC 60204-1"],
    description: "Machine control panels typically require an emergency stop function; category and circuit design are determined by the risk assessment.",
    inputs: ["machine_risk_assessment"],
    severity: "warning",
    implementation: "E-stop device added to BOM; stop category and safety circuit design require engineer decision.",
  },
  {
    id: "control_circuit_protection", name: "Control circuit protection", family: "IEC",
    standard: ["IEC 60204-1", "IEC 60947"],
    description: "Control circuits require their own overcurrent protection.",
    inputs: ["control_voltage"],
    severity: "info",
    implementation: "Dedicated 1P MCB for the control circuit; coil voltage of contactors must match the control supply.",
  },
  {
    id: "conductor_standard_sizes", name: "Standard conductor sizes", family: "IEC",
    standard: ["IEC 60228"],
    description: "Cable cross-sections are chosen from the standard nominal size series.",
    inputs: ["required_csa"],
    severity: "info",
    implementation: "Series: 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120 mm².",
  },
  {
    id: "cable_fire_performance", name: "Cable fire performance (metadata)", family: "IEC",
    standard: ["IEC 60332"],
    description: "Fire-performance class of cables is recorded as metadata from the manufacturer's datasheet.",
    inputs: ["cable_datasheet"],
    severity: "info",
    implementation: "Metadata only — VeatsAI performs no fire tests. Confirm from manufacturer documentation.",
  },
];

export function getRule(id: string): StandardRule {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`Unknown standards rule: ${id}`);
  return rule;
}

export function rulesForFamily(family: StandardFamily): StandardRule[] {
  return RULES.filter((r) => r.family === family);
}

export function isFamilyImplemented(family: StandardFamily): boolean {
  return STANDARD_FAMILIES.find((f) => f.family === family)?.status === "implemented";
}

/** Standards referenced by a set of rule ids (deduplicated, catalog order). */
export function standardsForRules(ruleIds: string[]): StandardDefinition[] {
  const codes = new Set(ruleIds.flatMap((id) => getRule(id).standard));
  return STANDARDS.filter((s) => codes.has(s.code));
}
