/**
 * VeatsAI domain types.
 * Shared by the AI service, engineering engine, standards engine, BOM, inventory,
 * cost, CAD and quote modules. Keep this file free of runtime logic.
 */

export type ProjectStatus =
  | "DRAFT"
  | "MISSING_INFORMATION"
  | "AI_PROCESSING"
  | "ENGINEERING_REVIEW"
  | "NEEDS_CHANGES"
  | "APPROVED";

/** Where a value came from. Every engineering result carries one of these. */
export type Provenance =
  | "AI_GENERATED"
  | "ENGINEERING_CALCULATION"
  | "STANDARDS_RULE"
  | "ASSUMED_VALUE"
  | "USER_PROVIDED"
  | "ENGINEER_OVERRIDE"
  | "CATALOG";

export type StartingMethod = "DOL" | "STAR_DELTA" | "SOFT_STARTER" | "VFD";
export type Environment = "indoor_clean" | "indoor_dusty" | "outdoor" | "wet_washdown";
export type InstallationMethod = "conduit_on_wall" | "cable_tray" | "buried" | "in_free_air";
export type StandardFamily = "IEC" | "NEC";

// ---------------------------------------------------------------- AI analysis

export interface MotorSpec {
  quantity: number;
  power_kw: number;
  label?: string | null;
}

/** Structured interpretation of a natural-language client request. */
export interface RequestAnalysis {
  project_type: "motor_control_panel" | "distribution_board" | "other";
  project_title: string;
  client_name: string | null;
  motors: MotorSpec[];
  voltage: number | null;
  frequency: number | null;
  phases: number | null;
  starting_method: StartingMethod | null;
  cable_length_m: number | null;
  environment: Environment | null;
  installation_method: InstallationMethod | null;
  ambient_temperature_c: number | null;
  short_circuit_current_ka: number | null;
  standards: string[];
  notes: string[];
  missing_information: string[];
  /** Which engine produced this analysis. */
  source: "ai" | "rule_based_fallback";
  model?: string;
}

// ---------------------------------------------------------- engineering inputs

/** A value that is either provided, assumed (default) or overridden by the engineer. */
export interface TracedValue<T> {
  value: T;
  provenance: Provenance;
  note?: string;
}

export interface DesignInputs {
  standard: StandardFamily;
  motors: MotorSpec[];
  voltage: TracedValue<number | null>;
  frequency: TracedValue<number>;
  phases: TracedValue<number>;
  power_factor: TracedValue<number>;
  efficiency: TracedValue<number>;
  starting_method: TracedValue<StartingMethod | null>;
  cable_length_m: TracedValue<number | null>;
  environment: TracedValue<Environment | null>;
  installation_method: TracedValue<InstallationMethod | null>;
  ambient_temperature_c: TracedValue<number | null>;
  short_circuit_current_ka: TracedValue<number | null>;
  max_voltage_drop_pct: TracedValue<number>;
}

// --------------------------------------------------------- engineering output

export type ResultStatus = "REQUIRES_REVIEW" | "INSUFFICIENT_DATA" | "OK" | "APPROVED";

/** One traceable engineering result: value + reason + rule + standard. */
export interface EngineeringResult {
  id: string;
  label: string;
  value: string;
  numeric?: number;
  unit?: string;
  formula?: string;
  reason: string;
  rule_id: string;
  standards: string[];
  provenance: Provenance;
  status: ResultStatus;
}

export type WarningSeverity = "info" | "warning" | "critical";

export interface EngineeringWarning {
  id: string;
  message: string;
  severity: WarningSeverity;
  rule_id?: string;
  standards?: string[];
  /** Critical warnings must be acknowledged before approval. */
  acknowledged?: boolean;
  acknowledged_by?: string;
}

export interface MotorCircuitResult {
  motor_index: number;
  label: string;
  power_kw: number;
  quantity: number;
  full_load_current_a: number;
  starting_current_a: number;
  branch_protection_a: number;
  contactor_ac3_a: number;
  overload_range_target_a: number;
  cable_csa_mm2: number | null;
  cable_ampacity_a: number | null;
  voltage_drop_pct: number | null;
}

export interface EngineeringCalculation {
  inputs_snapshot: DesignInputs;
  motor_circuits: MotorCircuitResult[];
  total_current_a: number;
  main_breaker_a: number;
  results: EngineeringResult[];
  warnings: EngineeringWarning[];
  required_ip_rating: string | null;
}

// ------------------------------------------------------------- catalog / BOM

export type ProductType =
  | "mcb"
  | "mccb"
  | "rccb"
  | "spd"
  | "contactor"
  | "overload_relay"
  | "mpcb"
  | "vfd"
  | "soft_starter"
  | "power_cable"
  | "control_wire"
  | "earth_wire"
  | "solar_cable"
  | "installation_cable"
  | "enclosure"
  | "din_rail"
  | "trunking"
  | "cable_tray"
  | "terminal_block"
  | "connector"
  | "cable_gland"
  | "ferrule"
  | "cable_lug"
  | "pushbutton"
  | "emergency_stop"
  | "pilot_light"
  | "consumable";

export interface ProductAttributes {
  product_type: ProductType;
  manufacturer?: string;
  poles?: number;
  rated_current_a?: number;
  curve?: string;
  range_min_a?: number;
  range_max_a?: number;
  power_kw?: number;
  csa_mm2?: number;
  cores?: number;
  ip_rating?: string;
  dimensions_mm?: string;
  coil_voltage?: string;
  standards?: string[];
}

export interface Product {
  sku: string;
  name: string;
  category: string;
  unit: string;
  purchase_price_eur: number;
  selling_price_eur: number;
  stock_quantity: number;
  min_stock_level: number;
  attributes: ProductAttributes;
  /** "client_dataset" = provided inventory; "demo_supplement" = dummy item added for the demo. */
  source: "client_dataset" | "demo_supplement";
}

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNAVAILABLE";

export interface BomLine {
  id: string;
  category: string;
  function: string;
  name: string;
  sku: string | null;
  manufacturer: string | null;
  specification: string;
  required_spec: string;
  quantity: number;
  unit: string;
  unit_price: number;
  purchase_price: number;
  stock: number;
  min_stock_level: number;
  stock_status: StockStatus;
  standard_reference: string[];
  reasoning: string;
  provenance: Provenance;
  overridden?: boolean;
}

// --------------------------------------------------------------------- cost

export interface CostSettings {
  labor_rate_eur_h: number;
  labor_hours: TracedValue<number>;
  engineering_rate_eur_h: number;
  engineering_hours: TracedValue<number>;
  margin_pct: number;
}

export interface CostBreakdown {
  material_cost: number;
  material_purchase_cost: number;
  labor_hours: number;
  labor_cost: number;
  engineering_hours: number;
  engineering_cost: number;
  subtotal: number;
  margin_pct: number;
  margin_amount: number;
  total: number;
  currency: "EUR";
  excluded_lines: string[];
}

// --------------------------------------------------------------------- CAD

export interface CadComponent {
  type: "supply" | "breaker" | "mpcb" | "contactor" | "overload" | "vfd" | "soft_starter" | "motor" | "busbar" | "control";
  name: string;
  quantity?: number;
  power_kw?: number;
  rating?: string;
  group?: number;
}

/** CAD data contract — the JSON that a CAD integration (local SVG/DXF, AutoCAD MCP…) consumes. */
export interface CadContract {
  project: string;
  voltage: number | null;
  standard: string;
  components: CadComponent[];
}

export interface CadOutput {
  adapter: string;
  contract: CadContract;
  svg: string;
  dxf: string;
  generated_at: string;
}

// ------------------------------------------------------------------ project

export interface EngineeringNote {
  id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface ReviewEvent {
  id: string;
  action: string;
  author: string;
  detail?: string;
  created_at: string;
}

/** Per-BOM-line engineer edits, applied on top of the generated BOM. */
export interface BomOverride {
  sku?: string | null;
  quantity?: number;
  unit_price?: number;
  removed?: boolean;
}

export interface CustomBomLine {
  id: string;
  sku: string;
  quantity: number;
}

export interface Design {
  calculation: EngineeringCalculation;
  bom: BomLine[];
  cost: CostBreakdown;
  cad: CadOutput | null;
  cad_error?: string;
  generated_at: string;
}

export interface Project {
  id: string;
  title: string;
  client_name: string;
  original_request: string;
  status: ProjectStatus;
  engineer: string;
  created_at: string;
  updated_at: string;
  analysis: RequestAnalysis | null;
  inputs: DesignInputs | null;
  cost_settings: CostSettings;
  bom_overrides: Record<string, BomOverride>;
  custom_lines: CustomBomLine[];
  acknowledged_warnings: Record<string, string>;
  notes: EngineeringNote[];
  history: ReviewEvent[];
  design: Design | null;
  approved_by?: string | null;
  approved_at?: string | null;
}

export interface Quote {
  id: string;
  project_id: string;
  quote_number: string;
  total: number;
  status: "DRAFT" | "ISSUED";
  approval_status: ProjectStatus;
  created_at: string;
}
