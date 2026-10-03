import { STARTING_METHOD_LABEL } from "../engineering/constants";
import { applyInventoryCheck } from "../inventory";
import { getRule } from "../standards";
import type {
  BomLine,
  BomOverride,
  CustomBomLine,
  EngineeringCalculation,
  EngineeringWarning,
  Product,
  ProductType,
  StartingMethod,
} from "../types";

/**
 * Component selection + Bill of Materials engine.
 * Deterministic: picks catalog products whose attributes satisfy the engineering results.
 * If nothing in the catalog satisfies a requirement, the line is kept with status "Component unavailable"
 * — we never silently substitute an undersized part.
 */

interface Need {
  id: string;
  category: string;
  fn: string;
  required_spec: string;
  quantity: number;
  unit?: string;
  rule: string;
  reasoning: string;
  match: (p: Product) => boolean;
  /** Ranking among matches — smallest wins. Default: selling price. */
  rank?: (p: Product) => number;
}

const ipDigits = (ip?: string | null) => {
  const m = ip?.match(/IP(\d)(\d)/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
export function ipSatisfies(actual?: string, required?: string | null): boolean {
  if (!required) return true;
  const a = ipDigits(actual);
  const r = ipDigits(required);
  return !!a && !!r && a[0] >= r[0] && a[1] >= r[1];
}

const is = (t: ProductType) => (p: Product) => p.attributes.product_type === t;
const inRange = (p: Product, a: number) =>
  p.attributes.range_min_a !== undefined && p.attributes.range_max_a !== undefined && a >= p.attributes.range_min_a && a <= p.attributes.range_max_a;

export function manufacturerOf(p: Product): string {
  return p.attributes.manufacturer ?? p.name.split(" ")[0];
}

function lineFromProduct(need: Need, p: Product | undefined): BomLine {
  const rule = getRule(need.rule);
  return {
    id: need.id,
    category: need.category,
    function: need.fn,
    name: p ? p.name : `${need.fn} — no matching catalog item`,
    sku: p?.sku ?? null,
    manufacturer: p ? manufacturerOf(p) : null,
    specification: p ? specOf(p) : "—",
    required_spec: need.required_spec,
    quantity: need.quantity,
    unit: p?.unit ?? need.unit ?? "pcs",
    unit_price: p?.selling_price_eur ?? 0,
    purchase_price: p?.purchase_price_eur ?? 0,
    stock: p?.stock_quantity ?? 0,
    min_stock_level: p?.min_stock_level ?? 0,
    stock_status: p ? "IN_STOCK" : "UNAVAILABLE",
    standard_reference: rule.standard,
    reasoning: need.reasoning,
    provenance: "CATALOG",
  };
}

export function specOf(p: Product): string {
  const a = p.attributes;
  const parts: string[] = [];
  if (a.poles) parts.push(`${a.poles}P`);
  if (a.rated_current_a) parts.push(`${a.rated_current_a} A`);
  if (a.curve) parts.push(`curve ${a.curve}`);
  if (a.range_min_a !== undefined) parts.push(`range ${a.range_min_a}–${a.range_max_a} A`);
  if (a.power_kw) parts.push(`${a.power_kw} kW`);
  if (a.cores && a.csa_mm2) parts.push(`${a.cores}×${a.csa_mm2} mm²`);
  else if (a.csa_mm2) parts.push(`${a.csa_mm2} mm²`);
  if (a.dimensions_mm) parts.push(a.dimensions_mm);
  if (a.ip_rating) parts.push(a.ip_rating);
  if (a.coil_voltage) parts.push(`coil ${a.coil_voltage}`);
  return parts.join(", ") || p.category;
}

function pick(products: Product[], need: Need): Product | undefined {
  const rank = need.rank ?? ((p: Product) => p.selling_price_eur);
  return products.filter(need.match).sort((a, b) => rank(a) - rank(b))[0];
}

export function generateBaseBom(calc: EngineeringCalculation, products: Product[]): BomLine[] {
  const inputs = calc.inputs_snapshot;
  const method = inputs.starting_method.value as StartingMethod;
  const length = inputs.cable_length_m.value;
  const needs: Need[] = [];
  const nMotors = calc.motor_circuits.reduce((s, c) => s + c.quantity, 0);

  // ---- Main incomer
  needs.push({
    id: "main_breaker", category: "Protection", fn: "Main incoming breaker",
    required_spec: `3P, In ≥ ${calc.main_breaker_a} A`, quantity: 1, rule: "main_incomer_selection",
    reasoning: `Calculated total current ${calc.total_current_a} A → ${calc.main_breaker_a} A standard rating.`,
    match: (p) => ["mccb", "mcb"].includes(p.attributes.product_type) && p.attributes.poles === 3 && (p.attributes.rated_current_a ?? 0) >= calc.main_breaker_a,
    rank: (p) => p.attributes.rated_current_a ?? 0,
  });

  // ---- Motor circuits
  for (const c of calc.motor_circuits) {
    const q = c.quantity;
    const tag = `${c.label} (${q} × ${c.power_kw} kW)`;
    const mpcb = products.find((p) => is("mpcb")(p) && inRange(p, c.full_load_current_a));
    const useMpcb = method !== "VFD" && method !== "STAR_DELTA" && !!mpcb;

    if (useMpcb) {
      needs.push({
        id: `${c.label}.protection`, category: "Motor Protection", fn: `Motor protection switch — ${tag}`,
        required_spec: `range incl. ${c.full_load_current_a} A`, quantity: q, rule: "overload_setting",
        reasoning: `MPCB covers short-circuit + overload; FLC ${c.full_load_current_a} A within device range.`,
        match: (p) => is("mpcb")(p) && inRange(p, c.full_load_current_a),
      });
    } else {
      needs.push({
        id: `${c.label}.protection`, category: "Protection", fn: `Branch circuit breaker — ${tag}`,
        required_spec: `3P, In ≥ ${c.branch_protection_a} A`, quantity: q, rule: "overcurrent_protection_coordination",
        reasoning: `Calculated design current = ${c.full_load_current_a} A → ${c.branch_protection_a} A. No motor protection switch in catalog covers ${c.full_load_current_a} A.`,
        match: (p) => ["mcb", "mccb"].includes(p.attributes.product_type) && p.attributes.poles === 3 && (p.attributes.rated_current_a ?? 0) >= c.branch_protection_a,
        rank: (p) => p.attributes.rated_current_a ?? 0,
      });
    }

    if (method === "VFD") {
      needs.push({
        id: `${c.label}.vfd`, category: "Motor Control", fn: `Variable frequency drive — ${tag}`,
        required_spec: `≥ ${c.power_kw} kW, ≥ ${c.full_load_current_a} A`, quantity: q, rule: "contactor_ac3_selection",
        reasoning: "VFD sized on motor power and current; drive provides electronic motor overload protection (verify configuration).",
        match: (p) => is("vfd")(p) && (p.attributes.power_kw ?? 0) >= c.power_kw && (p.attributes.rated_current_a ?? 0) >= c.full_load_current_a,
        rank: (p) => p.attributes.power_kw ?? 0,
      });
    } else {
      if (method === "SOFT_STARTER") {
        needs.push({
          id: `${c.label}.softstarter`, category: "Motor Control", fn: `Soft starter — ${tag}`,
          required_spec: `≥ ${c.power_kw} kW`, quantity: q, rule: "motor_starting_current",
          reasoning: "Soft starter selected per starting method.",
          match: (p) => is("soft_starter")(p) && (p.attributes.power_kw ?? 0) >= c.power_kw,
        });
      }
      const contactorsPerMotor = method === "STAR_DELTA" ? 3 : 1;
      needs.push({
        id: `${c.label}.contactor`, category: "Motor Control",
        fn: `${method === "STAR_DELTA" ? "Line / delta / star contactors" : method === "SOFT_STARTER" ? "Bypass contactor" : "Motor contactor"} — ${tag}`,
        required_spec: `AC-3 ≥ ${c.contactor_ac3_a} A`, quantity: q * contactorsPerMotor, rule: "contactor_ac3_selection",
        reasoning: `${STARTING_METHOD_LABEL[method]}: AC-3 rating ≥ ${c.contactor_ac3_a} A at ${inputs.voltage.value} V.`,
        match: (p) => is("contactor")(p) && (p.attributes.rated_current_a ?? 0) >= c.contactor_ac3_a,
        rank: (p) => p.attributes.rated_current_a ?? 0,
      });
      if (!useMpcb) {
        needs.push({
          id: `${c.label}.overload`, category: "Motor Protection", fn: `Overload relay — ${tag}`,
          required_spec: `setting range incl. ${c.overload_range_target_a} A`, quantity: q, rule: "overload_setting",
          reasoning: `Overload setting ${c.overload_range_target_a} A must lie within the relay range.`,
          match: (p) => is("overload_relay")(p) && inRange(p, c.overload_range_target_a),
        });
      }
    }

    // Motor cable
    const runs = method === "STAR_DELTA" ? 2 : 1;
    needs.push({
      id: `${c.label}.cable`, category: "Cables", fn: `Motor cable — ${tag}`,
      required_spec: c.cable_csa_mm2 ? `Cu ≥ ${c.cable_csa_mm2} mm², 5-core${runs > 1 ? `, ${runs} runs per motor` : ""}` : "Insufficient data",
      quantity: length ? Math.ceil(length * q * runs) : 0, unit: "meter", rule: "cable_current_capacity",
      reasoning: length
        ? `${length} m × ${q} motor(s)${runs > 1 ? ` × ${runs} runs` : ""}. Iz ${c.cable_ampacity_a} A, ΔU ${c.voltage_drop_pct} %.`
        : "Cable length not provided — quantity set to 0 (not costed).",
      match: (p) => is("power_cable")(p) && (p.attributes.csa_mm2 ?? 0) >= (c.cable_csa_mm2 ?? Infinity),
      rank: (p) => p.attributes.csa_mm2 ?? 0,
    });
  }

  // ---- Control circuit
  needs.push({
    id: "control_mcb", category: "Protection", fn: "Control circuit protection",
    required_spec: "1P MCB", quantity: 1, rule: "control_circuit_protection",
    reasoning: "Dedicated overcurrent protection for the control circuit.",
    match: (p) => is("mcb")(p) && p.attributes.poles === 1,
  });
  needs.push(
    { id: "ctrl.start", category: "Operator Controls", fn: "Start pushbutton", required_spec: "22 mm, 1NO", quantity: nMotors, rule: "control_circuit_protection", reasoning: "One per motor.", match: (p) => p.sku === "DEMO-PB-START" },
    { id: "ctrl.stop", category: "Operator Controls", fn: "Stop pushbutton", required_spec: "22 mm, 1NC", quantity: nMotors, rule: "control_circuit_protection", reasoning: "One per motor.", match: (p) => p.sku === "DEMO-PB-STOP" },
    { id: "ctrl.lamp", category: "Operator Controls", fn: "Run indicator", required_spec: "22 mm LED", quantity: nMotors, rule: "control_circuit_protection", reasoning: "One per motor.", match: is("pilot_light") },
    { id: "ctrl.estop", category: "Operator Controls", fn: "Emergency stop", required_spec: "Mushroom head, 2NC", quantity: 1, rule: "emergency_stop", reasoning: "Machine control panel — category per risk assessment.", match: is("emergency_stop") },
  );

  // ---- Enclosure & mounting
  const needsLarge = nMotors > 2 || method === "VFD" || method === "STAR_DELTA";
  const reqIp = calc.required_ip_rating;
  needs.push({
    id: "enclosure", category: "Enclosure", fn: "Panel enclosure",
    required_spec: `${needsLarge ? "≥ 800×1000 mm" : "≥ 600×400 mm"}${reqIp ? `, ≥ ${reqIp}` : ", IP: requires environmental specification"}`,
    quantity: 1, rule: reqIp ? "enclosure_ip_rating" : "assembly_verification",
    reasoning: `Size estimated from ${nMotors} motor feeder(s)${needsLarge ? " — large enclosure" : ""}. ${reqIp ? `Minimum ${reqIp} from environment.` : "IP rating requires environmental specification."} Final layout & heat dissipation per IEC 61439 verification.`,
    match: (p) => is("enclosure")(p) && ipSatisfies(p.attributes.ip_rating, reqIp) && (!needsLarge || (p.attributes.dimensions_mm ?? "").startsWith("800")),
  });
  const dinRails = Math.ceil(nMotors / 2) + 1;
  needs.push(
    { id: "din_rail", category: "Mounting", fn: "DIN rail", required_spec: "35 mm", quantity: dinRails, rule: "assembly_verification", reasoning: `${dinRails} rails estimated for device rows.`, match: is("din_rail") },
    { id: "trunking", category: "Mounting", fn: "Wiring duct", required_spec: "slotted, ~40×60", quantity: 3 + nMotors, rule: "assembly_verification", reasoning: "Estimated from panel size.", match: is("trunking") },
  );

  // ---- Terminals & wiring
  const maxCsa = Math.max(...calc.motor_circuits.map((c) => c.cable_csa_mm2 ?? 0));
  needs.push(
    {
      id: "terminals_power", category: "Terminals", fn: "Power terminal blocks", required_spec: `≥ ${Math.max(maxCsa, 6)} mm²`,
      quantity: 4 * nMotors + 5, rule: "conductor_standard_sizes", reasoning: "3 phases + PE per motor, plus incoming L1-L3/N/PE.",
      match: (p) => is("terminal_block")(p) && (p.attributes.csa_mm2 ?? 0) >= Math.max(maxCsa, 6), rank: (p) => p.attributes.csa_mm2 ?? 0,
    },
    {
      id: "terminals_control", category: "Terminals", fn: "Control terminal blocks", required_spec: "2.5 mm²",
      quantity: 6 * nMotors + 10, rule: "control_circuit_protection", reasoning: "Control I/O per motor + common.",
      match: (p) => is("terminal_block")(p) && p.attributes.csa_mm2 === 2.5,
    },
    { id: "wire_control", category: "Wiring", fn: "Control wiring", required_spec: "1.5 mm² flexible", quantity: 15 + 8 * nMotors, unit: "meter", rule: "conductor_standard_sizes", reasoning: "Estimated internal control wiring.", match: is("control_wire") },
    { id: "wire_earth", category: "Wiring", fn: "Protective earth wiring", required_spec: "6 mm² green/yellow", quantity: 3 + 2 * nMotors, unit: "meter", rule: "conductor_standard_sizes", reasoning: "Estimated internal PE bonding.", match: is("earth_wire") },
    {
      id: "glands_power", category: "Hardware", fn: "Cable glands (power)", required_spec: maxCsa >= 6 ? "M32" : "M20",
      quantity: nMotors * (method === "STAR_DELTA" ? 2 : 1) + 1, rule: "enclosure_ip_rating", reasoning: "One per motor cable + incoming. Verify gland range vs cable outer diameter.",
      match: (p) => is("cable_gland")(p) && p.attributes.dimensions_mm === (maxCsa >= 6 ? "M32" : "M20"),
    },
    { id: "glands_control", category: "Hardware", fn: "Cable glands (control)", required_spec: "M20", quantity: 2, rule: "enclosure_ip_rating", reasoning: "Control / signal cables.", match: (p) => is("cable_gland")(p) && p.attributes.dimensions_mm === "M20" },
    { id: "ferrules", category: "Hardware", fn: "Wire ferrules", required_spec: "1.5 mm²", quantity: 1, unit: "pack", rule: "conductor_standard_sizes", reasoning: "Control wiring terminations.", match: is("ferrule") },
    { id: "ties", category: "Consumables", fn: "Cable ties", required_spec: "200 mm", quantity: 1, unit: "pack", rule: "assembly_verification", reasoning: "Consumable.", match: (p) => p.sku === "CONS-TIE-200" },
  );
  if (calc.main_breaker_a >= 80) {
    needs.push({ id: "lugs", category: "Hardware", fn: "Incoming cable lugs", required_spec: "35 mm²", quantity: 5, rule: "conductor_standard_sizes", reasoning: "Incoming supply terminations — confirm incoming cable size (supply cable not in scope).", match: is("cable_lug") });
  }

  return needs.map((n) => lineFromProduct(n, pick(products, n)));
}

/** Apply engineer overrides (replace / quantity / price / remove) and custom lines, then re-check inventory. */
export function finalizeBom(
  base: BomLine[],
  overrides: Record<string, BomOverride>,
  custom: CustomBomLine[],
  products: Product[],
): BomLine[] {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const lines: BomLine[] = [];
  for (const line of base) {
    const o = overrides[line.id];
    if (!o) {
      lines.push(line);
      continue;
    }
    if (o.removed) continue;
    let next: BomLine = { ...line, overridden: true, provenance: "ENGINEER_OVERRIDE" };
    if (o.sku && o.sku !== line.sku) {
      const p = bySku.get(o.sku);
      if (p) {
        next = {
          ...next, sku: p.sku, name: p.name, manufacturer: manufacturerOf(p), specification: specOf(p), unit: p.unit,
          unit_price: p.selling_price_eur, purchase_price: p.purchase_price_eur, stock: p.stock_quantity, min_stock_level: p.min_stock_level,
          reasoning: `Replaced by engineer. Original requirement: ${line.required_spec}.`,
        };
      }
    }
    if (o.quantity !== undefined) next.quantity = o.quantity;
    if (o.unit_price !== undefined) next.unit_price = o.unit_price;
    lines.push(next);
  }
  for (const c of custom) {
    const p = bySku.get(c.sku);
    if (!p) continue;
    const o = overrides[c.id];
    lines.push({
      id: c.id, category: p.category, function: "Added by engineer", name: p.name, sku: p.sku, manufacturer: manufacturerOf(p),
      specification: specOf(p), required_spec: "—", quantity: o?.quantity ?? c.quantity, unit: p.unit,
      unit_price: o?.unit_price ?? p.selling_price_eur, purchase_price: p.purchase_price_eur, stock: p.stock_quantity, min_stock_level: p.min_stock_level,
      stock_status: "IN_STOCK", standard_reference: p.attributes.standards ?? [], reasoning: "Manually added by engineer.",
      provenance: "ENGINEER_OVERRIDE", overridden: true,
    });
  }
  return applyInventoryCheck(lines);
}

/** Warnings produced by component selection & inventory. */
export function bomWarnings(lines: BomLine[], calc: EngineeringCalculation, products: Product[]): EngineeringWarning[] {
  const w: EngineeringWarning[] = [];
  const bySku = new Map(products.map((p) => [p.sku, p]));

  // Coordination check on the ACTUAL selected devices: Ib ≤ In ≤ Iz.
  for (const c of calc.motor_circuits) {
    const prot = lines.find((l) => l.id === `${c.label}.protection`);
    const device = prot?.sku ? bySku.get(prot.sku) : undefined;
    const In = device?.attributes.product_type === "mpcb" ? undefined : device?.attributes.rated_current_a;
    if (In && c.cable_ampacity_a !== null && In > c.cable_ampacity_a) {
      w.push({
        id: `bom.${c.label}.coordination`, severity: "critical", rule_id: "overcurrent_protection_coordination", standards: ["IEC 60364", "IEC 60947"],
        message: `${c.label}: selected breaker In = ${In} A exceeds calculated cable capacity Iz = ${c.cable_ampacity_a} A (${c.cable_csa_mm2} mm²). Ib ≤ In ≤ Iz not satisfied — use a ${c.branch_protection_a} A device or increase the cable size.`,
      });
    }
    const cable = lines.find((l) => l.id === `${c.label}.cable`);
    const csa = cable?.sku ? bySku.get(cable.sku)?.attributes.csa_mm2 : undefined;
    if (csa && c.cable_csa_mm2 && csa < c.cable_csa_mm2) {
      w.push({ id: `bom.${c.label}.cable_undersized`, severity: "critical", rule_id: "cable_current_capacity", standards: ["IEC 60364"], message: `${c.label}: selected cable ${csa} mm² is smaller than the calculated ${c.cable_csa_mm2} mm².` });
    }
  }

  for (const l of lines) {
    if (l.stock_status === "UNAVAILABLE") {
      w.push({ id: `bom.${l.id}.unavailable`, severity: "critical", rule_id: undefined, standards: l.standard_reference, message: `Component unavailable: ${l.function} (${l.required_spec}). No catalog item satisfies the requirement — source externally or replace.` });
    } else if (l.stock_status === "OUT_OF_STOCK") {
      w.push({ id: `bom.${l.id}.out`, severity: "critical", standards: [], message: `Out of stock: ${l.name} — required ${l.quantity} ${l.unit}, available ${l.stock}.` });
    } else if (l.stock_status === "LOW_STOCK") {
      w.push({ id: `bom.${l.id}.low`, severity: "info", standards: [], message: `Low stock after this project: ${l.name} (available ${l.stock}, min level ${l.min_stock_level}).` });
    }
    if (l.sku === "CTRL-CNT-001") {
      w.push({ id: `bom.${l.id}.coil`, severity: "info", rule_id: "control_circuit_protection", standards: ["IEC 60204-1"], message: "Selected contactor LC1D32BD has a 24 V DC coil — control circuit supply must match (24 V DC PSU not in BOM)." });
    }
  }
  return w;
}
