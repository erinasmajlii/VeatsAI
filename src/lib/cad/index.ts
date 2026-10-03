import type { BomLine, CadComponent, CadContract, CadOutput, EngineeringCalculation, StartingMethod } from "../types";

/**
 * CAD module.
 *
 * generateCAD(project data) → CadContract (JSON) → adapter → SVG preview + DXF file.
 *
 * The CadContract is the integration boundary: the same JSON can later be sent to an
 * AutoCAD / MCP integration (see `autocadMcpAdapter`). The local adapter draws a
 * single-line diagram with simple geometry primitives so SVG and DXF are always identical.
 */

// ------------------------------------------------------------------ contract

export function buildCadContract(title: string, calc: EngineeringCalculation, bom: BomLine[]): CadContract {
  const method = calc.inputs_snapshot.starting_method.value as StartingMethod;
  const has = (prefix: string, kind: string) => bom.some((l) => l.id === `${prefix}.${kind}`);
  const components: CadComponent[] = [
    { type: "supply", name: "Incoming supply", rating: `${calc.inputs_snapshot.voltage.value} V 3~ ${calc.inputs_snapshot.frequency.value} Hz` },
    { type: "breaker", name: "Main MCCB", rating: `${calc.main_breaker_a} A` },
    { type: "busbar", name: "Main busbar", rating: `${calc.total_current_a} A` },
  ];
  calc.motor_circuits.forEach((c, group) => {
    const protIsMpcb = bom.find((l) => l.id === `${c.label}.protection`)?.category === "Motor Protection";
    components.push({ type: protIsMpcb ? "mpcb" : "breaker", name: `${c.label} protection`, quantity: c.quantity, rating: `${c.branch_protection_a} A`, group });
    if (method === "VFD") components.push({ type: "vfd", name: `${c.label} VFD`, quantity: c.quantity, rating: `${c.power_kw} kW`, group });
    if (method === "SOFT_STARTER") components.push({ type: "soft_starter", name: `${c.label} soft starter`, quantity: c.quantity, group });
    if (method !== "VFD") components.push({ type: "contactor", name: `${c.label} contactor${method === "STAR_DELTA" ? " (Y-Δ)" : ""}`, quantity: c.quantity, rating: `AC-3 ≥ ${c.contactor_ac3_a} A`, group });
    if (has(c.label, "overload")) components.push({ type: "overload", name: `${c.label} overload`, quantity: c.quantity, rating: `${c.overload_range_target_a} A`, group });
    components.push({ type: "motor", name: c.label, quantity: c.quantity, power_kw: c.power_kw, rating: `${c.full_load_current_a} A`, group });
  });
  // Carry catalog data (manufacturer / SKU) so CAD integrations can fill MFG / CAT attributes.
  const BOM_KIND: Partial<Record<CadComponent["type"], string>> = { breaker: "protection", mpcb: "protection", contactor: "contactor", overload: "overload", vfd: "vfd", soft_starter: "softstarter" };
  for (const comp of components) {
    const label = comp.group === undefined ? null : calc.motor_circuits[comp.group]?.label;
    const lineId = comp.group === undefined ? (comp.name === "Main MCCB" ? "main_breaker" : null) : BOM_KIND[comp.type] && `${label}.${BOM_KIND[comp.type]}`;
    const line = lineId ? bom.find((l) => l.id === lineId) : undefined;
    if (line?.sku) {
      comp.manufacturer = line.manufacturer ?? undefined;
      comp.catalog = line.sku;
    }
  }
  return { project: title, voltage: calc.inputs_snapshot.voltage.value, standard: calc.inputs_snapshot.standard, components };
}

// ---------------------------------------------------------------- geometry

type Prim =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; layer?: string }
  | { k: "rect"; x: number; y: number; w: number; h: number; layer?: string }
  | { k: "circle"; cx: number; cy: number; r: number; layer?: string }
  | { k: "text"; x: number; y: number; s: string; size: number; anchor?: "start" | "middle"; layer?: string };

function layout(contract: CadContract): { prims: Prim[]; width: number; height: number } {
  const p: Prim[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, layer = "POWER") => p.push({ k: "line", x1, y1, x2, y2, layer });
  const rect = (x: number, y: number, w: number, h: number, layer = "DEVICES") => p.push({ k: "rect", x, y, w, h, layer });
  const text = (x: number, y: number, s: string, size = 10, anchor: "start" | "middle" = "start", layer = "TEXT") => p.push({ k: "text", x, y, s, size, anchor, layer });

  // Expand motor groups into individual feeders (cap for readability).
  const groups = contract.components.filter((c) => c.type === "motor");
  const feeders: { group: number; index: number; total: number }[] = [];
  groups.forEach((g) => {
    for (let i = 0; i < (g.quantity ?? 1); i++) feeders.push({ group: g.group ?? 0, index: i, total: g.quantity ?? 1 });
  });
  const shown = feeders.slice(0, 10);
  const colW = 130;
  const width = Math.max(560, shown.length * colW + 120);
  const cx = width / 2;

  // Supply + main breaker
  const supply = contract.components.find((c) => c.type === "supply");
  const main = contract.components.find((c) => c.type === "breaker" && c.name === "Main MCCB");
  text(cx, 24, "INCOMING SUPPLY", 11, "middle");
  text(cx, 38, supply?.rating ?? "", 10, "middle");
  line(cx, 44, cx, 70);
  drawBreaker(cx, 70, "Q0", main?.rating ?? "", "Main MCCB");
  line(cx, 110, cx, 140);

  // Busbar
  const busY = 140;
  const x0 = 60 + colW / 2;
  const xN = x0 + (shown.length - 1) * colW;
  line(Math.min(x0, cx) - 20, busY, Math.max(xN, cx) + 20, busY, "BUSBAR");
  line(Math.min(x0, cx) - 20, busY + 3, Math.max(xN, cx) + 20, busY + 3, "BUSBAR");
  text(Math.max(xN, cx) + 24, busY + 6, "L1/L2/L3", 9);

  shown.forEach((f, i) => {
    const x = x0 + i * colW;
    const devices = contract.components.filter((c) => c.group === f.group && c.type !== "motor");
    const motor = groups.find((g) => g.group === f.group)!;
    const tag = `${motor.name}${f.total > 1 ? `.${f.index + 1}` : ""}`;
    let y = busY + 3;
    line(x, y, x, y + 22);
    y += 22;
    devices.forEach((d) => {
      const tag = `${d.type === "mpcb" ? "Q" : d.type === "breaker" ? "Q" : d.type === "contactor" ? "K" : d.type === "overload" ? "F" : d.type === "vfd" ? "U" : "G"}${i + 1}`;
      const rating = d.rating ?? "";
      if (d.type === "breaker" || d.type === "mpcb") drawBreaker(x, y, tag, rating, d.type === "mpcb" ? "MPCB" : "MCB");
      else if (d.type === "contactor") drawContactor(x, y, tag, rating);
      else if (d.type === "overload") drawOverload(x, y, tag, rating);
      else drawBox(x, y, tag, rating, d.type === "vfd" ? "VFD" : "Soft starter");
      y += 40;
      line(x, y, x, y + 22);
      y += 22;
    });
    // Motor
    p.push({ k: "circle", cx: x, cy: y + 24, r: 24, layer: "DEVICES" });
    text(x, y + 22, "M", 13, "middle");
    text(x, y + 36, "3~", 9, "middle");
    text(x, y + 64, tag, 10, "middle");
    text(x, y + 77, `${motor.power_kw} kW · ${motor.rating}`, 9, "middle");
  });
  if (feeders.length > shown.length) text(xN + 40, busY + 60, `+${feeders.length - shown.length} more feeders`, 10);

  const maxDevices = Math.max(...groups.map((g) => contract.components.filter((c) => c.group === g.group && c.type !== "motor").length), 1);
  const bottom = busY + 25 + maxDevices * 62 + 100;

  // Title block
  rect(10, bottom, width - 20, 52, "TITLE");
  line(width * 0.6, bottom, width * 0.6, bottom + 52, "TITLE");
  text(20, bottom + 20, contract.project, 12, "start");
  text(20, bottom + 38, `Single-line diagram · ${contract.standard}-referenced`, 9);
  text(width * 0.6 + 10, bottom + 20, "PRELIMINARY — engineer review req.", 9);
  text(width * 0.6 + 10, bottom + 38, `${contract.voltage} V · ${feeders.length} feeder(s) · VeatsAI`, 9);

  return { prims: p, width, height: bottom + 62 };

  // Device label block: tag (Q1/K1/F1), rating and kind stacked to the right of the symbol, never overlapping.
  function label(x: number, y: number, tag: string, rating: string, kind: string) {
    text(x + 22, y + 11, tag, 10);
    text(x + 22, y + 23, rating.slice(0, 16), 8);
    text(x + 22, y + 35, kind, 8);
  }
  function drawBreaker(x: number, y: number, tag: string, rating: string, kind: string) {
    rect(x - 16, y, 32, 40);
    line(x - 7, y + 13, x + 7, y + 27, "DEVICES");
    line(x + 7, y + 13, x - 7, y + 27, "DEVICES");
    label(x, y, tag, rating, kind);
  }
  function drawContactor(x: number, y: number, tag: string, rating: string) {
    rect(x - 16, y, 32, 40);
    line(x - 10, y + 16, x + 10, y + 16, "DEVICES");
    line(x - 10, y + 24, x + 10, y + 24, "DEVICES");
    label(x, y, tag, rating, "Contactor");
  }
  function drawOverload(x: number, y: number, tag: string, rating: string) {
    rect(x - 16, y, 32, 40);
    line(x - 8, y + 26, x - 4, y + 14, "DEVICES");
    line(x - 4, y + 14, x + 4, y + 26, "DEVICES");
    line(x + 4, y + 26, x + 8, y + 14, "DEVICES");
    label(x, y, tag, rating, "Overload");
  }
  function drawBox(x: number, y: number, tag: string, rating: string, kind: string) {
    rect(x - 16, y, 32, 40);
    text(x, y + 24, tag.replace(/\d+$/, ""), 8, "middle");
    label(x, y, tag, rating, kind);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toSvg(prims: Prim[], width: number, height: number): string {
  const body = prims
    .map((q) => {
      switch (q.k) {
        case "line":
          return `<line x1="${q.x1}" y1="${q.y1}" x2="${q.x2}" y2="${q.y2}" class="${q.layer === "BUSBAR" ? "bus" : "ln"}"/>`;
        case "rect":
          return `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" class="dev"/>`;
        case "circle":
          return `<circle cx="${q.cx}" cy="${q.cy}" r="${q.r}" class="dev"/>`;
        case "text":
          return `<text x="${q.x}" y="${q.y}" font-size="${q.size}" text-anchor="${q.anchor ?? "start"}">${esc(q.s)}</text>`;
      }
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Single-line diagram"><style>.ln{stroke:#0f172a;stroke-width:1.5}.bus{stroke:#0f172a;stroke-width:3}.dev{fill:#fff;stroke:#0f172a;stroke-width:1.5}text{font-family:ui-monospace,Menlo,Consolas,monospace;fill:#0f172a}</style><rect width="${width}" height="${height}" fill="#fff"/>${body}</svg>`;
}

/** Minimal AutoCAD R12 ASCII DXF (LINE / CIRCLE / TEXT entities on named layers). */
function toDxf(prims: Prim[], height: number): string {
  const out: (string | number)[] = [0, "SECTION", 2, "ENTITIES"];
  const Y = (y: number) => +(height - y).toFixed(2);
  const ln = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    out.push(0, "LINE", 8, layer, 10, x1, 20, Y(y1), 30, 0, 11, x2, 21, Y(y2), 31, 0);
  for (const q of prims) {
    const layer = q.layer ?? "0";
    if (q.k === "line") ln(layer, q.x1, q.y1, q.x2, q.y2);
    else if (q.k === "rect") {
      ln(layer, q.x, q.y, q.x + q.w, q.y);
      ln(layer, q.x + q.w, q.y, q.x + q.w, q.y + q.h);
      ln(layer, q.x + q.w, q.y + q.h, q.x, q.y + q.h);
      ln(layer, q.x, q.y + q.h, q.x, q.y);
    } else if (q.k === "circle") out.push(0, "CIRCLE", 8, layer, 10, q.cx, 20, Y(q.cy), 30, 0, 40, q.r);
    else {
      const x = q.anchor === "middle" ? q.x - (q.s.length * q.size * 0.6) / 2 : q.x;
      out.push(0, "TEXT", 8, layer, 10, +x.toFixed(2), 20, Y(q.y), 30, 0, 40, q.size * 0.8, 1, q.s.replace(/[^\x20-\x7E]/g, (c) => ({ "≥": ">=", "·": "-", "Δ": "D", "—": "-", "~": "~" })[c] ?? "?"));
    }
  }
  out.push(0, "ENDSEC", 0, "EOF");
  return out.join("\r\n");
}

// ------------------------------------------------------------------ adapters

export interface CadAdapter {
  id: string;
  name: string;
  status: "available" | "not_configured";
  description: string;
  generate(contract: CadContract): Promise<Omit<CadOutput, "contract" | "generated_at">>;
}

export const localAdapter: CadAdapter = {
  id: "local-svg-dxf",
  name: "Local generator (SVG + DXF)",
  status: "available",
  description: "Built-in single-line diagram generator. Produces SVG preview and AutoCAD-compatible R12 DXF.",
  async generate(contract) {
    const { prims, width, height } = layout(contract);
    return { adapter: this.id, svg: toSvg(prims, width, height), dxf: toDxf(prims, height) };
  },
};

/**
 * AutoCAD / MCP integration abstraction. Not implemented in the MVP: when configured
 * (AUTOCAD_MCP_URL), it would send the CadContract JSON to an MCP server that drives AutoCAD.
 */
export const autocadMcpAdapter: CadAdapter = {
  id: "autocad-mcp",
  name: "AutoCAD via MCP",
  status: process.env.AUTOCAD_MCP_URL ? "available" : "not_configured",
  description: "Sends the CAD data contract to an AutoCAD MCP server. Integration planned — not part of the MVP.",
  async generate() {
    throw new Error("AutoCAD MCP integration is not implemented in this MVP.");
  },
};

export const CAD_ADAPTERS = [localAdapter, autocadMcpAdapter];

/** generateCAD(project) — tries the configured adapter, falls back to the local generator. */
export async function generateCAD(title: string, calc: EngineeringCalculation, bom: BomLine[]): Promise<CadOutput> {
  const contract = buildCadContract(title, calc, bom);
  const preferred = CAD_ADAPTERS.find((a) => a.id === process.env.CAD_ADAPTER && a.status === "available");
  let result: Omit<CadOutput, "contract" | "generated_at">;
  try {
    result = await (preferred ?? localAdapter).generate(contract);
  } catch {
    result = await localAdapter.generate(contract);
  }
  return { ...result, contract, generated_at: new Date().toISOString() };
}
