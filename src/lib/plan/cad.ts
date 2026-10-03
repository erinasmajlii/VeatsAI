import type { DxfDoc } from "./dxf";
import type { ElectricalDevice, ElectricalPlan, PlanAnalysis, Pt } from "./types";

/**
 * CAD file for the electrical plan: the ORIGINAL drawing geometry (on its own layers) plus the electrical
 * layers on top — symbols, cable routes, circuit tags, circuit schedule, legend and title block.
 *
 * Output is ASCII DXF (R12 / AC1009 entity set: LINE, ARC, CIRCLE, TEXT, POLYLINE, SOLID) which AutoCAD,
 * AutoCAD LT, BricsCAD and LibreCAD open directly. All coordinates are in the drawing's own units.
 */

export interface CadMeta {
  project_title: string;
  project_id: string;
  client: string;
  status: string; // e.g. "PRELIMINARY — NOT APPROVED" / "APPROVED by …"
  date: string;
}

const ELEC_LAYERS: { name: string; color: number; ltype: "CONTINUOUS" | "VEATS_DASH" }[] = [
  { name: "E-LIGHT", color: 5, ltype: "CONTINUOUS" },
  { name: "E-SWITCH", color: 3, ltype: "CONTINUOUS" },
  { name: "E-SOCKET", color: 30, ltype: "CONTINUOUS" },
  { name: "E-SPECIAL", color: 6, ltype: "CONTINUOUS" },
  { name: "E-DATA", color: 4, ltype: "CONTINUOUS" },
  { name: "E-PANEL", color: 1, ltype: "CONTINUOUS" },
  { name: "E-WIRE-LIGHT", color: 5, ltype: "VEATS_DASH" },
  { name: "E-WIRE-SOCKET", color: 30, ltype: "VEATS_DASH" },
  { name: "E-WIRE-SPECIAL", color: 6, ltype: "VEATS_DASH" },
  { name: "E-TEXT", color: 7, ltype: "CONTINUOUS" },
  { name: "E-LEGEND", color: 7, ltype: "CONTINUOUS" },
  { name: "E-TITLE", color: 7, ltype: "CONTINUOUS" },
];

const ascii = (s: string) =>
  s
    .replace(/×/g, "x").replace(/[²]/g, "2").replace(/[³]/g, "3").replace(/°/g, "%%d").replace(/±/g, "%%p").replace(/[Ø⌀]/g, "%%c")
    .replace(/[—–]/g, "-").replace(/[·•]/g, "-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
const layerName = (s: string) => ascii(s).replace(/[<>/\\":;?*|=`,]/g, "_").slice(0, 31).toUpperCase() || "0";

class Dxf {
  out: (string | number)[] = [];
  entities = 0;
  push(...v: (string | number)[]) { this.out.push(...v); }
  num(n: number) { return Number.isFinite(n) ? +n.toFixed(4) : 0; }
  line(layer: string, x1: number, y1: number, x2: number, y2: number, ltype?: string) {
    this.entities++;
    this.push(0, "LINE", 8, layer, ...(ltype ? [6, ltype] : []), 10, this.num(x1), 20, this.num(y1), 30, 0, 11, this.num(x2), 21, this.num(y2), 31, 0);
  }
  circle(layer: string, cx: number, cy: number, r: number) {
    this.entities++;
    this.push(0, "CIRCLE", 8, layer, 10, this.num(cx), 20, this.num(cy), 30, 0, 40, this.num(r));
  }
  arc(layer: string, cx: number, cy: number, r: number, a0deg: number, a1deg: number) {
    this.entities++;
    this.push(0, "ARC", 8, layer, 10, this.num(cx), 20, this.num(cy), 30, 0, 40, this.num(r), 50, this.num(a0deg), 51, this.num(a1deg));
  }
  text(layer: string, x: number, y: number, h: number, s: string, rotDeg = 0) {
    const t = ascii(s);
    if (!t.trim()) return;
    this.entities++;
    this.push(0, "TEXT", 8, layer, 10, this.num(x), 20, this.num(y), 30, 0, 40, this.num(h), 1, t, ...(rotDeg ? [50, this.num(rotDeg)] : []));
  }
  poly(layer: string, pts: Pt[], ltype?: string, closed = false) {
    if (pts.length < 2) return;
    this.entities++;
    this.push(0, "POLYLINE", 8, layer, ...(ltype ? [6, ltype] : []), 66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0);
    for (const [x, y] of pts) this.push(0, "VERTEX", 8, layer, 10, this.num(x), 20, this.num(y), 30, 0);
    this.push(0, "SEQEND", 8, layer);
  }
  solid(layer: string, p: [Pt, Pt, Pt, Pt]) {
    this.entities++;
    this.push(0, "SOLID", 8, layer, 10, this.num(p[0][0]), 20, this.num(p[0][1]), 30, 0, 11, this.num(p[1][0]), 21, this.num(p[1][1]), 31, 0, 12, this.num(p[2][0]), 22, this.num(p[2][1]), 32, 0, 13, this.num(p[3][0]), 23, this.num(p[3][1]), 33, 0);
  }
}

export function buildPlanDxf(doc: DxfDoc, a: PlanAnalysis, e: ElectricalPlan, meta: CadMeta): { dxf: string; entities: number; layers: number } {
  const f = a.scale.factor_to_m;
  const U = 1 / f; // drawing units per metre
  const X = (m: number) => m * U;
  const P = (p: Pt): Pt => [p[0] * U, p[1] * U];
  const d = new Dxf();

  // ---------------- entities first (so extents are known), assembled into the final file below
  for (const p of doc.prims) {
    const L = layerName(p.layer);
    if (p.k === "seg") d.line(L, p.a[0], p.a[1], p.b[0], p.b[1]);
    else if (p.k === "arc") d.arc(L, p.c[0], p.c[1], p.r, (p.a0 * 180) / Math.PI, (p.a1 * 180) / Math.PI);
    else if (p.k === "circle") d.circle(L, p.c[0], p.c[1], p.r);
    else d.text(L, p.at[0], p.at[1], p.h, p.s, (p.rot * 180) / Math.PI);
  }

  const tagH = X(0.18);
  const drawDevice = (dev: ElectricalDevice) => {
    const [x, y] = P(dev.at);
    const fc = dev.facing ?? [0, 1];
    const tan: Pt = [-fc[1], fc[0]];
    const r = X(dev.kind === "luminaire" ? 0.15 : dev.kind === "switch" ? 0.07 : 0.1);
    switch (dev.kind) {
      case "luminaire": {
        d.circle("E-LIGHT", x, y, r);
        d.line("E-LIGHT", x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7);
        d.line("E-LIGHT", x - r * 0.7, y + r * 0.7, x + r * 0.7, y - r * 0.7);
        break;
      }
      case "switch": {
        d.circle("E-SWITCH", x, y, r);
        d.line("E-SWITCH", x, y, x + (fc[0] + tan[0]) * X(0.16), y + (fc[1] + tan[1]) * X(0.16));
        break;
      }
      case "socket": {
        d.circle("E-SOCKET", x, y, r);
        d.line("E-SOCKET", x - tan[0] * r * 1.5 - fc[0] * r, y - tan[1] * r * 1.5 - fc[1] * r, x + tan[0] * r * 1.5 - fc[0] * r, y + tan[1] * r * 1.5 - fc[1] * r);
        break;
      }
      case "special_socket": {
        const s = r * 1.1;
        d.poly("E-SPECIAL", [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]], undefined, true);
        d.circle("E-SPECIAL", x, y, r * 0.55);
        break;
      }
      case "point": {
        if (dev.description.startsWith("Outdoor")) {
          d.circle("E-DATA", x, y, r);
          d.line("E-DATA", x - r * 1.4, y, x + r * 1.4, y);
          d.line("E-DATA", x, y - r * 1.4, x, y + r * 1.4);
        } else {
          const s = r * 1.2;
          d.poly("E-DATA", [[x - s, y - s * 0.8], [x + s, y - s * 0.8], [x, y + s]], undefined, true);
        }
        break;
      }
      case "panel": {
        const w = X(0.55), h = X(0.2);
        const c: Pt = [Math.cos(Math.atan2(tan[1], tan[0])), Math.sin(Math.atan2(tan[1], tan[0]))];
        const nrm: Pt = fc;
        const corners: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [x + c[0] * sx * w / 2 + nrm[0] * sy * h / 2, y + c[1] * sx * w / 2 + nrm[1] * sy * h / 2] as Pt);
        d.solid("E-PANEL", [corners[0], corners[1], corners[3], corners[2]]);
        d.text("E-TEXT", x + nrm[0] * X(0.35) - X(0.25), y + nrm[1] * X(0.35), tagH * 1.2, "DB1");
        break;
      }
    }
  };
  for (const dev of [...e.devices, e.panel]) drawDevice(dev);
  // circuit tags beside protected devices, plus one at the middle of every route
  for (const dev of e.devices) {
    if (!dev.circuit || dev.kind === "luminaire") continue;
    const [x, y] = P(dev.at);
    d.text("E-TEXT", x + X(0.14), y + X(0.14), tagH, dev.circuit);
  }
  for (const c of e.circuits) {
    const layer = c.kind === "lighting" ? "E-WIRE-LIGHT" : c.kind === "sockets" ? "E-WIRE-SOCKET" : "E-WIRE-SPECIAL";
    d.poly(layer, c.route.map(P), "VEATS_DASH");
    const mid = c.route[Math.floor(c.route.length / 2)];
    if (mid) d.text("E-TEXT", X(mid[0]) + X(0.12), X(mid[1]) + X(0.12), tagH * 1.15, c.id);
  }

  // ---------------- schedule, legend, notes, title block to the right of the plan
  const [ex0, ey0, ex1, ey1] = a.extents;
  const ox = ex1 + 3; // metres
  let oy = ey1;
  const th = X(0.26);
  const T = (xm: number, ym: number, s: string, h = th, layer = "E-LEGEND") => d.text(layer, X(xm), X(ym), h, s);
  T(ox, oy, "ELECTRICAL PLAN - PRELIMINARY", X(0.45), "E-TITLE");
  oy -= 0.9;
  T(ox, oy, "LEGEND", th * 1.1); oy -= 0.55;
  const legendSample = (kind: string, ym: number) => {
    const dev: ElectricalDevice = { id: "", tag: "", kind: kind as ElectricalDevice["kind"], at: [ox + 0.3, ym + 0.1], room_id: null, circuit: null, description: kind === "outdoor" ? "Outdoor" : "Data", facing: [0, 1] };
    if (kind === "outdoor") dev.kind = "point"; else if (kind === "data") dev.kind = "point";
    drawDevice(dev);
  };
  const legendRows: [string, string][] = [["luminaire", "Ceiling luminaire"], ["switch", "Light switch"], ["socket", "Socket 16 A"], ["special_socket", "Appliance connection point"], ["data", "Data outlet"], ["outdoor", "Outdoor luminaire"], ["panel", "Distribution board DB1"]];
  for (const [k, label] of legendRows) {
    if (k === "luminaire" && !e.devices.some((x) => x.kind === "luminaire")) continue;
    legendSample(k, oy);
    T(ox + 0.9, oy, label);
    oy -= 0.5;
  }
  d.line("E-WIRE-LIGHT", X(ox), X(oy + 0.1), X(ox + 0.6), X(oy + 0.1), "VEATS_DASH");
  T(ox + 0.9, oy, "Cable route (dashed; tag = circuit)");
  oy -= 1.0;

  T(ox, oy, "CIRCUIT SCHEDULE", th * 1.1); oy -= 0.6;
  const cols = [1.2, 8.6, 3.9, 4.1, 1.7, 1.6, 1.2];
  const heads = ["Circ.", "Description", "Protection", "Cable", "kW", "Ib A", "Ph."];
  const tableW = cols.reduce((s, v) => s + v, 0);
  const rowH = 0.55;
  const row = (cells: string[], ym: number, head = false) => {
    let x = ox;
    cells.forEach((c, i) => { T(x + 0.08, ym - rowH + 0.17, head ? c.toUpperCase() : c, X(0.2)); x += cols[i]; });
    d.line("E-LEGEND", X(ox), X(ym - rowH), X(ox + tableW), X(ym - rowH));
  };
  d.line("E-LEGEND", X(ox), X(oy), X(ox + tableW), X(oy));
  row(heads, oy, true); oy -= rowH;
  for (const c of e.circuits) {
    row([c.id, c.name.length > 40 ? c.name.slice(0, 39) + "." : c.name, c.protection, c.cable, (c.load_w / 1000).toFixed(2), String(c.design_current_a), c.phase], oy);
    oy -= rowH;
  }
  // vertical grid
  { let x = ox; const top = oy + rowH * (e.circuits.length + 1); for (const w of [0, ...cols]) { x += w; d.line("E-LEGEND", X(x), X(top), X(x), X(oy)); } }
  oy -= 0.7;
  const t = e.technical;
  T(ox, oy, "TECHNICAL DATA", th * 1.1); oy -= 0.55;
  for (const s of [
    `Supply: ${t.system}, ${t.frequency_hz} Hz`,
    `Connected load ${(t.connected_load_w / 1000).toFixed(1)} kW - demand ${(t.demand_load_w / 1000).toFixed(1)} kW - Ib ${t.design_current_a} A`,
    `Main protection: ${t.main_protection}`,
    `Cable (total, incl. drops): ${t.cable_total_m} m`,
    `Standards referenced: ${t.standards.join(", ")}`,
    "Preliminary design - requires engineer review and approval.",
  ]) { T(ox, oy, s); oy -= 0.5; }
  oy -= 0.4;
  // title block
  const tb = [`Project: ${meta.project_title}`, `Client: ${meta.client}`, `Ref: ${meta.project_id}   Date: ${meta.date}`, `Status: ${meta.status}`];
  d.poly("E-TITLE", [P([ox - 0.2, oy + 0.3]), P([ox + 16, oy + 0.3]), P([ox + 16, oy - tb.length * 0.55 - 0.1]), P([ox - 0.2, oy - tb.length * 0.55 - 0.1])], undefined, true);
  tb.forEach((s, i) => T(ox, oy - i * 0.55, s, th * (i === 0 ? 1.1 : 1), "E-TITLE"));
  oy -= tb.length * 0.55 + 0.4;

  // ---------------- assemble
  const origLayers = [...doc.layers.values()].map((l) => ({ name: layerName(l.name), color: l.color || 7, ltype: "CONTINUOUS" as const }));
  const seen = new Set<string>();
  const layers = [{ name: "0", color: 7, ltype: "CONTINUOUS" as const }, ...origLayers, ...ELEC_LAYERS].filter((l) => (seen.has(l.name) ? false : (seen.add(l.name), true)));
  const ext = { x0: X(Math.min(ex0, ox) - 2), y0: X(Math.min(ey0, oy) - 2), x1: X(ox + 18), y1: X(ey1 + 2) };

  const head: (string | number)[] = [
    0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSBASE", 10, 0, 20, 0, 30, 0,
    9, "$EXTMIN", 10, d.num(ext.x0), 20, d.num(ext.y0), 30, 0, 9, "$EXTMAX", 10, d.num(ext.x1), 20, d.num(ext.y1), 30, 0, 9, "$LTSCALE", 40, 1,
    0, "ENDSEC",
    0, "SECTION", 2, "TABLES",
    0, "TABLE", 2, "LTYPE", 70, 2,
    0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0,
    0, "LTYPE", 2, "VEATS_DASH", 70, 0, 3, "Dashed", 72, 65, 73, 2, 40, d.num(0.3 * U), 49, d.num(0.2 * U), 49, d.num(-0.1 * U),
    0, "ENDTAB",
    0, "TABLE", 2, "LAYER", 70, layers.length,
  ];
  for (const l of layers) head.push(0, "LAYER", 2, l.name, 70, 0, 62, l.color, 6, l.ltype);
  head.push(
    0, "ENDTAB",
    0, "TABLE", 2, "STYLE", 70, 1,
    0, "STYLE", 2, "STANDARD", 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 0.2, 3, "txt", 4, "",
    0, "ENDTAB",
    0, "ENDSEC",
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 8, 0, 2, "$MODEL_SPACE", 70, 0, 10, 0, 20, 0, 30, 0, 3, "$MODEL_SPACE", 1, "", 0, "ENDBLK", 8, 0,
    0, "BLOCK", 67, 1, 8, 0, 2, "$PAPER_SPACE", 70, 0, 10, 0, 20, 0, 30, 0, 3, "$PAPER_SPACE", 1, "", 0, "ENDBLK", 67, 1, 8, 0,
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
  );
  const all = [...head, ...d.out, 0, "ENDSEC", 0, "EOF"];
  return { dxf: all.join("\r\n") + "\r\n", entities: d.entities, layers: layers.length };
}
