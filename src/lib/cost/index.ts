import type { BomLine, CostBreakdown, CostSettings, EngineeringCalculation } from "../types";

/**
 * Cost Engine.
 * Final Quote = (Material + Labor + Engineering) × (1 + Margin %)
 * Material is priced at catalog selling price; purchase cost is shown internally only.
 */

export const DEFAULT_COST_SETTINGS: CostSettings = {
  labor_rate_eur_h: 35,
  labor_hours: { value: 0, provenance: "ASSUMED_VALUE", note: "Estimated from panel scope" },
  engineering_rate_eur_h: 60,
  engineering_hours: { value: 0, provenance: "ASSUMED_VALUE", note: "Estimated from panel scope" },
  margin_pct: 20,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic hour estimates (used unless the engineer overrides them). */
export function estimateHours(calc: EngineeringCalculation) {
  const motors = calc.motor_circuits.reduce((s, c) => s + c.quantity, 0);
  return {
    labor: 6 + 3.5 * motors + 2, // assembly base + wiring per feeder + testing
    engineering: 4 + 1 * motors, // design, documentation, review
  };
}

export function resolveCostSettings(settings: CostSettings, calc: EngineeringCalculation): CostSettings {
  const est = estimateHours(calc);
  return {
    ...settings,
    labor_hours: settings.labor_hours.provenance === "ASSUMED_VALUE" ? { value: est.labor, provenance: "ASSUMED_VALUE", note: "Estimate: 8 h base + 3.5 h per motor feeder" } : settings.labor_hours,
    engineering_hours: settings.engineering_hours.provenance === "ASSUMED_VALUE" ? { value: est.engineering, provenance: "ASSUMED_VALUE", note: "Estimate: 4 h base + 1 h per motor" } : settings.engineering_hours,
  };
}

export function calculateCost(bom: BomLine[], settings: CostSettings): CostBreakdown {
  const excluded = bom.filter((l) => l.stock_status === "UNAVAILABLE" || l.quantity === 0).map((l) => l.function);
  const priced = bom.filter((l) => l.stock_status !== "UNAVAILABLE");
  const material = priced.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const purchase = priced.reduce((s, l) => s + l.quantity * l.purchase_price, 0);
  const labor = settings.labor_hours.value * settings.labor_rate_eur_h;
  const engineering = settings.engineering_hours.value * settings.engineering_rate_eur_h;
  const subtotal = material + labor + engineering;
  const margin = (subtotal * settings.margin_pct) / 100;
  return {
    material_cost: r2(material),
    material_purchase_cost: r2(purchase),
    labor_hours: settings.labor_hours.value,
    labor_cost: r2(labor),
    engineering_hours: settings.engineering_hours.value,
    engineering_cost: r2(engineering),
    subtotal: r2(subtotal),
    margin_pct: settings.margin_pct,
    margin_amount: r2(margin),
    total: r2(subtotal + margin),
    currency: "EUR",
    excluded_lines: excluded,
  };
}
