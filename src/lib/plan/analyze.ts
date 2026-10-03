import type { DxfDoc, DxfPrim } from "./dxf";
import {
  arcPoints, bboxOf, centroid, cleanRing, dist, distToSegment, inPoly, lerp, norm, perp, round, roundPt, simplifyRing, sub,
} from "./geom";
import type {
  BBox, LayerRole, PlanAnalysis, PlanLayerInfo, PlanOpening, PlanRoom, PlanScale, PlanStair, PlanWall, PlanWarning, Pt, PreviewPrim, RoomType,
} from "./types";

/**
 * Architectural plan analysis.
 *
 * Deterministic geometry — no guessing hidden from the engineer: every assumption (units, wall layer,
 * gap closing) is returned as a warning. Rooms are found by rasterising the wall geometry (door and
 * window openings are closed) and flood-filling the enclosed regions, which is robust to double-line
 * walls, T-junctions and small gaps.
 */

// ------------------------------------------------------------------ layer roles

const ROLE_PATTERNS: [LayerRole, RegExp][] = [
  ["door", /DOOR|ESHT|TUER|TÜR|PORTA|PORTE|(^|[-_ .])DR([-_ .]|$)/i],
  ["window", /WIND|GLAZ|FENST|FEN[-_ ]|DRITAR|VITRIN/i],
  ["stairs", /STAIR|SHKALL|TREPP|ESCAL/i],
  ["dimension", /DIM|COTA|QUOTE|KOTA/i],
  ["wall", /WALL|MUR|PARET|MAUER|WAND|ZID|MURATUR/i],
  ["furniture", /FURN|FIXT|EQUIP|MOBIL|PAJIS|SANIT|APPLI/i],
  ["column", /COLUMN|KOLON|STRUCT|PILLAR/i],
  ["text", /TEXT|ANNO|NOTE|LABEL|ROOM|SPACE|ZONE|DHOM|TXT|AREA|NAME/i],
];
export function roleOfName(name: string): LayerRole {
  for (const [role, re] of ROLE_PATTERNS) if (re.test(name)) return role;
  return "other";
}

// ------------------------------------------------------------------ units

const INS_UNITS: Record<number, { unit: PlanScale["unit"]; f: number }> = {
  1: { unit: "in", f: 0.0254 }, 2: { unit: "ft", f: 0.3048 }, 4: { unit: "mm", f: 0.001 }, 5: { unit: "cm", f: 0.01 }, 6: { unit: "m", f: 1 },
};
const plausible = (d: number, f: number) => d * f >= 3 && d * f <= 400;

function detectScale(doc: DxfDoc, spanDu: number): PlanScale {
  const header = doc.insUnits ? INS_UNITS[doc.insUnits] : undefined;
  if (header && plausible(spanDu, header.f)) {
    return { unit: header.unit, factor_to_m: header.f, source: "header", assumed: false, note: `Drawing units read from the file header (${header.unit}).` };
  }
  const candidates: { unit: PlanScale["unit"]; f: number }[] = [{ unit: "mm", f: 0.001 }, { unit: "cm", f: 0.01 }, { unit: "m", f: 1 }];
  const found = candidates.find((c) => plausible(spanDu, c.f));
  if (found) {
    const why = header ? `The header declares ${header.unit}, but that gives an implausible building size, so ` : "The file declares no usable units, so ";
    return { unit: found.unit, factor_to_m: found.f, source: "inferred", assumed: true, note: `${why}${found.unit} was inferred from the drawing extent (${round(spanDu * found.f, 1)} m across). Verify the scale.` };
  }
  return { unit: "m", factor_to_m: 1, source: "inferred", assumed: true, note: "Units could not be determined; metres were assumed. Verify the scale." };
}

// ------------------------------------------------------------------ room semantics

const NAME_RULES: [RoomType, RegExp][] = [
  ["bathroom", /\b(bath|wc|toilet|shower|banj|tualet|lavatory|restroom|bad|dusche)/i],
  ["kitchen", /\b(kitchen|kuzhin|kuhinj|cuisine|k[uü]che|pantry|kitchenette)/i],
  ["bedroom", /\b(bed|gjumi|schlaf|sleep|dhom[eë] gjumi|chamber)/i],
  ["living", /\b(living|ndenj|salon|lounge|wohn|dining|ngren|sitting)/i],
  ["meeting", /\b(meeting|mbledh|konferen|conference|boardroom|besprech)/i],
  ["office", /\b(office|zyr|bureau|b[uü]ro|open ?space|workspace|studio|reception|pritje)/i],
  ["entrance", /\b(entrance|hyrj|foyer|vestibul|lobby|eingang|entry)/i],
  ["corridor", /\b(corridor|koridor|korridor|hall|flur|hapsir|passage|gang)/i],
  ["stairs", /\b(stair|shkall|treppe)/i],
  ["laundry", /\b(laundry|lavand|washing|waschk)/i],
  ["garage", /\b(garage|garazh)/i],
  ["technical", /\b(technical|teknik|mechanical|boiler|server|plant|utility|elektr|electrical room|riser)/i],
  ["storage", /\b(storage|depo|magaz|store|abstellr|archive|arkiv|closet|wardrobe|kambr)/i],
  ["terrace", /\b(terrace|balcon|ballkon|veranda|terras|loggia)/i],
];
const FUNCTION_TEXT: Record<RoomType, string> = {
  office: "Workspace", meeting: "Meeting / collaboration", kitchen: "Food preparation", bathroom: "Sanitary (wet area)", bedroom: "Sleeping",
  living: "Living / dining", corridor: "Circulation", entrance: "Entrance / circulation", storage: "Storage", garage: "Vehicle storage",
  technical: "Technical / services", laundry: "Laundry (wet area)", terrace: "Outdoor / covered", stairs: "Vertical circulation", room: "General space",
};

function classifyRoom(name: string | null, area: number, minWidth: number, longSide: number): { type: RoomType; source: "text" | "inferred" } {
  if (name) for (const [t, re] of NAME_RULES) if (re.test(name)) return { type: t, source: "text" };
  if (area < 2.5) return { type: "storage", source: "inferred" };
  if (minWidth < 1.9 && longSide / Math.max(minWidth, 0.01) > 3) return { type: "corridor", source: "inferred" };
  return { type: "room", source: "inferred" };
}

// ------------------------------------------------------------------ helpers

interface Seg { a: Pt; b: Pt; layer: string }

function toSegs(prims: DxfPrim[], f: number, pred: (p: DxfPrim) => boolean): Seg[] {
  const out: Seg[] = [];
  for (const p of prims) {
    if (!pred(p)) continue;
    if (p.k === "seg") out.push({ a: [p.a[0] * f, p.a[1] * f], b: [p.b[0] * f, p.b[1] * f], layer: p.layer });
    else if (p.k === "arc") {
      const pts = arcPoints([p.c[0] * f, p.c[1] * f], p.r * f, p.a0, p.a1);
      for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i], layer: p.layer });
    }
  }
  return out.filter((s) => dist(s.a, s.b) > 0.01);
}

/** Merge collinear overlapping segments (same layer) so the wall list stays compact. */
function mergeSegments(segs: Seg[]): Seg[] {
  const buckets = new Map<string, { s: Seg; ang: number; off: number; t0: number; t1: number }[]>();
  for (const s of segs) {
    let ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang = 0;
    const d: Pt = [Math.cos(ang), Math.sin(ang)];
    const off = -s.a[0] * d[1] + s.a[1] * d[0];
    const t0 = s.a[0] * d[0] + s.a[1] * d[1];
    const t1 = s.b[0] * d[0] + s.b[1] * d[1];
    const key = `${s.layer}|${Math.round(ang / 0.0087)}|${Math.round(off / 0.01)}`;
    const arr = buckets.get(key) ?? [];
    arr.push({ s, ang, off, t0: Math.min(t0, t1), t1: Math.max(t0, t1) });
    buckets.set(key, arr);
  }
  const out: Seg[] = [];
  for (const arr of buckets.values()) {
    arr.sort((x, y) => x.t0 - y.t0);
    let cur = arr[0];
    const emit = (c: typeof cur) => {
      const d: Pt = [Math.cos(c.ang), Math.sin(c.ang)];
      const n: Pt = [-d[1], d[0]];
      out.push({ layer: c.s.layer, a: [d[0] * c.t0 + n[0] * c.off, d[1] * c.t0 + n[1] * c.off], b: [d[0] * c.t1 + n[0] * c.off, d[1] * c.t1 + n[1] * c.off] });
    };
    for (let i = 1; i < arr.length; i++) {
      const n = arr[i];
      if (n.t0 <= cur.t1 + 0.02) cur = { ...cur, t1: Math.max(cur.t1, n.t1) };
      else { emit(cur); cur = n; }
    }
    emit(cur);
  }
  return out;
}

interface Grid {
  x0: number; y0: number; c: number; w: number; h: number;
  wall: Uint8Array; lbl: Int32Array; dt: Uint8Array | Uint16Array; outside: number;
}
const cellOf = (g: Grid, p: Pt): [number, number] => [Math.floor((p[0] - g.x0) / g.c), Math.floor((p[1] - g.y0) / g.c)];
const inGrid = (g: Grid, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h;

function paintSeg(g: Grid, a: Pt, b: Pt, r: number) {
  const l = dist(a, b);
  const n = Math.max(1, Math.ceil(l / (g.c * 0.5)));
  for (let i = 0; i <= n; i++) {
    const p = lerp(a, b, i / n);
    const [cx, cy] = cellOf(g, p);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (inGrid(g, x, y)) g.wall[y * g.w + x] = 1;
    }
  }
}

function floodLabel(g: Grid): number {
  const { w, h, wall, lbl } = g;
  lbl.fill(0);
  let next = 0;
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (wall[s] || lbl[s]) continue;
    next++;
    let sp = 0;
    stack[sp++] = s;
    lbl[s] = next;
    while (sp) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && !wall[i - 1] && !lbl[i - 1]) { lbl[i - 1] = next; stack[sp++] = i - 1; }
      if (x < w - 1 && !wall[i + 1] && !lbl[i + 1]) { lbl[i + 1] = next; stack[sp++] = i + 1; }
      if (y > 0 && !wall[i - w] && !lbl[i - w]) { lbl[i - w] = next; stack[sp++] = i - w; }
      if (y < h - 1 && !wall[i + w] && !lbl[i + w]) { lbl[i + w] = next; stack[sp++] = i + w; }
    }
  }
  return next;
}

/** Chamfer (3-4) distance to the nearest wall cell, in 1/3 cell units. */
function distanceTransform(g: Grid): Uint16Array {
  const { w, h, wall } = g;
  const INF = 60000;
  const d = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = wall[i] ? 0 : INF;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 3);
      if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 3);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
    }
    d[i] = v;
  }
  return d;
}

function traceRing(g: Grid, label: number, bounds: [number, number, number, number]): Pt[] {
  const [bx0, by0, bx1, by1] = bounds;
  const { w, lbl } = g;
  const V = g.w + 1;
  const starts = new Map<number, number[]>();
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * V + x0;
    const arr = starts.get(k);
    const end = y1 * V + x1;
    if (arr) arr.push(end); else starts.set(k, [end]);
  };
  const is = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && lbl[y * w + x] === label;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    if (lbl[y * w + x] !== label) continue;
    if (!is(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!is(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!is(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!is(x - 1, y)) addEdge(x, y + 1, x, y);
  }
  let best: Pt[] = [];
  let bestA = -1;
  while (starts.size) {
    const [k0] = starts.entries().next().value as [number, number[]];
    const ring: Pt[] = [];
    let k = k0;
    for (let guard = 0; guard < 4_000_000; guard++) {
      const outs = starts.get(k);
      if (!outs || !outs.length) break;
      const nk = outs.pop()!;
      if (!outs.length) starts.delete(k);
      ring.push([k % V, (k / V) | 0]);
      k = nk;
      if (k === k0) break;
    }
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
      a += x1 * y2 - x2 * y1;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = ring; }
  }
  return best.map(([x, y]) => [g.x0 + x * g.c, g.y0 + y * g.c] as Pt);
}

interface RawRoom { label: number; cells: number; bounds: [number, number, number, number]; maxD: number }

function findRooms(g: Grid, minArea: number, minInscribed: number): { rooms: RawRoom[]; count: number } {
  const count = floodLabel(g);
  g.dt = distanceTransform(g);
  const cells = new Int32Array(count + 1);
  const maxD = new Uint16Array(count + 1);
  const bounds: [number, number, number, number][] = [];
  for (let i = 0; i <= count; i++) bounds.push([g.w, g.h, -1, -1]);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    const l = g.lbl[i];
    if (!l) continue;
    cells[l]++;
    if (g.dt[i] > maxD[l]) maxD[l] = g.dt[i];
    const b = bounds[l];
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  g.outside = g.lbl[0];
  const rooms: RawRoom[] = [];
  for (let l = 1; l <= count; l++) {
    if (l === g.outside) continue;
    const area = cells[l] * g.c * g.c;
    const inscribed = (maxD[l] / 3) * g.c;
    if (area >= minArea && inscribed >= minInscribed) rooms.push({ label: l, cells: cells[l], bounds: bounds[l], maxD: inscribed });
  }
  return { rooms, count };
}


/**
 * Gap closing detects rooms on a dilated wall mask, which shrinks them by the dilation radius.
 * Grow every room back to the true wall lines (geodesically, through free cells only).
 */
function refineToWalls(chosen: { g: Grid; rooms: RawRoom[]; r: number }, g0: Grid): { g: Grid; rooms: RawRoom[]; r: number } {
  const keep = new Set<number>(chosen.rooms.map((r) => r.label));
  keep.add(chosen.g.outside);
  const { w, h } = g0;
  for (let i = 0; i < w * h; i++) g0.lbl[i] = !g0.wall[i] && keep.has(chosen.g.lbl[i]) ? chosen.g.lbl[i] : 0;
  g0.outside = chosen.g.outside;
  let frontier: number[] = [];
  for (let i = 0; i < w * h; i++) if (g0.lbl[i]) frontier.push(i);
  for (let step = 0; step < chosen.r + 1; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const l = g0.lbl[i];
      const x = i % w, y = (i / w) | 0;
      const tryN = (j: number) => { if (!g0.wall[j] && !g0.lbl[j]) { g0.lbl[j] = l; next.push(j); } };
      if (x > 0) tryN(i - 1);
      if (x < w - 1) tryN(i + 1);
      if (y > 0) tryN(i - w);
      if (y < h - 1) tryN(i + w);
    }
    frontier = next;
    if (!frontier.length) break;
  }
  const rooms: RawRoom[] = chosen.rooms.map((r) => ({ label: r.label, cells: 0, bounds: [w, h, -1, -1], maxD: r.maxD }));
  const byLabel = new Map(rooms.map((r) => [r.label, r]));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = byLabel.get(g0.lbl[y * w + x]);
    if (!r) continue;
    r.cells++;
    if (x < r.bounds[0]) r.bounds[0] = x;
    if (y < r.bounds[1]) r.bounds[1] = y;
    if (x > r.bounds[2]) r.bounds[2] = x;
    if (y > r.bounds[3]) r.bounds[3] = y;
  }
  return { g: g0, rooms, r: chosen.r };
}

const truncate = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const isAreaLabel = (s: string) => /^[\d\s.,]+\s*(m2|m²|sqm)?$/i.test(s.trim());

// ------------------------------------------------------------------ main

export function analyzeDxf(doc: DxfDoc): PlanAnalysis {
  const warnings: PlanWarning[] = [];
  let wi = 0;
  const warn = (severity: PlanWarning["severity"], message: string) => warnings.push({ id: `pw${++wi}`, severity, message });

  // --- layer roles
  const roleOf = new Map<string, LayerRole>();
  const counts = new Map<string, number>();
  for (const p of doc.prims) counts.set(p.layer, (counts.get(p.layer) ?? 0) + 1);
  for (const name of counts.keys()) roleOf.set(name, roleOfName(name));
  const role = (l: string) => roleOf.get(l) ?? "other";

  // --- wall layer selection
  let wallLayers = [...roleOf.entries()].filter(([, r]) => r === "wall").map(([n]) => n);
  let wallsAssumed: string | null = null;
  const segLen = new Map<string, { len: number; n: number }>();
  for (const p of doc.prims) {
    if (p.k !== "seg") continue;
    const e = segLen.get(p.layer) ?? { len: 0, n: 0 };
    e.len += dist(p.a, p.b);
    e.n++;
    segLen.set(p.layer, e);
  }
  if (!wallLayers.length) {
    const cand = [...segLen.entries()]
      .filter(([n]) => !["text", "dimension", "door", "window", "furniture", "stairs"].includes(role(n)))
      .sort((a, b) => b[1].len - a[1].len)[0];
    if (cand && cand[1].n >= 8) {
      wallLayers = [cand[0]];
      wallsAssumed = cand[0];
      roleOf.set(cand[0], "wall");
      warn("warning", `No layer is named as a wall layer — "${cand[0]}" (longest line work) was treated as walls. Confirm this is correct.`);
    }
  }
  if (!wallLayers.length) throw new Error("No wall geometry could be identified in this drawing.");

  // --- scale from wall extents (robust against stray entities)
  const wallPrimsDu = doc.prims.filter((p) => roleOf.get(p.layer) === "wall" && (p.k === "seg" || p.k === "arc"));
  const pts: Pt[] = [];
  for (const p of wallPrimsDu) { if (p.k === "seg") pts.push(p.a, p.b); else if (p.k === "arc") pts.push([p.c[0] - p.r, p.c[1] - p.r], [p.c[0] + p.r, p.c[1] + p.r]); }
  const bbDu = bboxOf(pts);
  const spanDu = Math.max(bbDu[2] - bbDu[0], bbDu[3] - bbDu[1]);
  const scale = detectScale(doc, spanDu);
  if (scale.assumed) warn("warning", scale.note);
  const f = scale.factor_to_m;

  const wallSegsRaw = toSegs(doc.prims, f, (p) => roleOf.get(p.layer) === "wall");
  const wallSegs = mergeSegments(wallSegsRaw);
  const wallBox = bboxOf(wallSegs.flatMap((s) => [s.a, s.b]));

  // --- openings (doors / windows), found before rasterising so they can close the wall envelope
  const toM = (p: Pt): Pt => [p[0] * f, p[1] * f];
  const nearestWall = (p: Pt) => {
    let best: { d: number; dir: Pt; q: Pt } | null = null;
    for (const s of wallSegs) {
      if (dist(s.a, s.b) < 0.4) continue; // end caps would give a perpendicular direction
      const r = distToSegment(p, s.a, s.b);
      if (!best || r.d < best.d) best = { d: r.d, dir: norm(sub(s.b, s.a)), q: r.q };
    }
    return best;
  };

  interface RawOpening { type: "door" | "window"; center: Pt; width: number; dir: Pt | null; layer: string; block: string | null; hinge?: Pt; swingMid?: Pt; closers: [Pt, Pt][] }
  const rawOpenings: RawOpening[] = [];
  for (const ins of doc.inserts) {
    const r = roleOf.get(ins.layer) ?? roleOfName(ins.layer);
    const byName = roleOfName(ins.name);
    const kind = r === "door" || byName === "door" ? "door" : r === "window" || byName === "window" ? "window" : null;
    if (!kind || !ins.bbox) continue;
    const bb: BBox = [ins.bbox[0] * f, ins.bbox[1] * f, ins.bbox[2] * f, ins.bbox[3] * f];
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (Math.max(w, h) < 0.3 || Math.max(w, h) > 6) continue;
    const center: Pt = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    const axis: Pt | null = kind === "window" && Math.abs(w - h) > 0.05 ? (w > h ? [1, 0] : [0, 1]) : null;
    rawOpenings.push({ type: kind, center, width: kind === "window" ? Math.max(w, h) : Math.min(Math.max(w, h), 1.6), dir: axis, layer: ins.layer, block: ins.name, closers: [] });
  }
  // door swing arcs (those not already belonging to a door block)
  for (const p of doc.prims) {
    if (p.k !== "arc" || roleOf.get(p.layer) !== "door") continue;
    const c = toM(p.c), r = p.r * f;
    let sweep = p.a1 - p.a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    if (r < 0.4 || r > 1.6 || sweep < 0.9 || sweep > 2.3) continue;
    const e0: Pt = [c[0] + r * Math.cos(p.a0), c[1] + r * Math.sin(p.a0)];
    const e1: Pt = [c[0] + r * Math.cos(p.a1), c[1] + r * Math.sin(p.a1)];
    const wn0 = nearestWall(e0)?.d ?? Infinity, wn1 = nearestWall(e1)?.d ?? Infinity;
    const along = wn0 <= wn1 ? e0 : e1;
    const open = wn0 <= wn1 ? e1 : e0;
    const mid: Pt = [c[0] + r * Math.cos(p.a0 + sweep / 2), c[1] + r * Math.sin(p.a0 + sweep / 2)];
    const center = lerp(c, along, 0.5);
    const dup = rawOpenings.find((o) => o.type === "door" && dist(o.center, center) < Math.max(0.6, r * 0.8) && o.block !== null);
    if (dup) { dup.hinge = c; dup.swingMid = mid; dup.dir = norm(sub(along, c)); dup.width = r; dup.center = center; dup.closers.push([c, along], [c, open]); continue; }
    if (rawOpenings.some((o) => o.type === "door" && o.block === null && dist(o.center, center) < 0.3)) continue;
    rawOpenings.push({ type: "door", center, width: r, dir: norm(sub(along, c)), layer: p.layer, block: null, hinge: c, swingMid: mid, closers: [[c, along], [c, open]] });
  }
  // windows drawn as plain geometry: cluster the segments of window layers
  {
    const ws = toSegs(doc.prims, f, (p) => roleOf.get(p.layer) === "window" && p.k === "seg");
    const insBoxes = rawOpenings.filter((o) => o.type === "window").map((o) => o.center);
    const parent = ws.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const near = Math.min(dist(ws[i].a, ws[j].a), dist(ws[i].a, ws[j].b), dist(ws[i].b, ws[j].a), dist(ws[i].b, ws[j].b), distToSegment(ws[i].a, ws[j].a, ws[j].b).d, distToSegment(ws[i].b, ws[j].a, ws[j].b).d);
      if (near < 0.35) parent[find(i)] = find(j);
    }
    const groups = new Map<number, Seg[]>();
    ws.forEach((s, i) => { const k = find(i); groups.set(k, [...(groups.get(k) ?? []), s]); });
    for (const g of groups.values()) {
      const bb = bboxOf(g.flatMap((s) => [s.a, s.b]));
      const w = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
      if (w < 0.4 || w > 6) continue;
      const center: Pt = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
      if (insBoxes.some((c) => dist(c, center) < 0.6)) continue;
      const bw = bb[2] - bb[0], bh = bb[3] - bb[1];
      rawOpenings.push({ type: "window", center, width: w, dir: Math.abs(bw - bh) > 0.05 ? (bw > bh ? [1, 0] : [0, 1]) : null, layer: g[0].layer, block: null, closers: [] });
    }
  }

  // --- orient & snap openings to the nearest wall
  for (const o of rawOpenings) {
    const nw = nearestWall(o.center);
    // Orientation only — openings sit in a gap of the wall line, so the centre is never moved.
    if (nw && nw.d < Math.max(0.8, o.width * 0.8) && !o.dir) o.dir = nw.dir;
    if (!o.dir) o.dir = [1, 0];
    if (!o.closers.length) {
      const h = o.width / 2;
      o.closers.push([[o.center[0] - o.dir[0] * h, o.center[1] - o.dir[1] * h], [o.center[0] + o.dir[0] * h, o.center[1] + o.dir[1] * h]]);
    }
  }

  // --- raster + rooms
  const margin = 1.2;
  const span = Math.max(wallBox[2] - wallBox[0], wallBox[3] - wallBox[1]) + margin * 2;
  let c = Math.max(0.05, span / 1800);
  c = Math.min(c, 0.1);
  if (span / c > 2600) c = span / 2600;
  const gridW = Math.ceil((wallBox[2] - wallBox[0] + margin * 2) / c) + 2;
  const gridH = Math.ceil((wallBox[3] - wallBox[1] + margin * 2) / c) + 2;
  const mkGrid = (): Grid => ({ x0: wallBox[0] - margin, y0: wallBox[1] - margin, c, w: gridW, h: gridH, wall: new Uint8Array(gridW * gridH), lbl: new Int32Array(gridW * gridH), dt: new Uint16Array(0), outside: 0 });
  const closerSegs: [Pt, Pt][] = rawOpenings.flatMap((o) => o.closers);

  const buildGrid = (r: number): Grid => {
    const g = mkGrid();
    for (const s of wallSegs) paintSeg(g, s.a, s.b, r);
    for (const [a, b] of closerSegs) paintSeg(g, a, b, r);
    // window geometry also closes the envelope
    for (const o of rawOpenings) if (o.type === "window") paintSeg(g, [o.center[0] - o.dir![0] * o.width / 2, o.center[1] - o.dir![1] * o.width / 2], [o.center[0] + o.dir![0] * o.width / 2, o.center[1] + o.dir![1] * o.width / 2], r);
    return g;
  };

  const radii = [0, 1, 2, 4, 6];
  let chosen: { g: Grid; rooms: RawRoom[]; r: number } | null = null;
  let bestCount = -1;
  const attempts: { g: Grid; rooms: RawRoom[]; r: number }[] = [];
  const minArea = 1.2;
  for (const r of radii) {
    const g = buildGrid(r);
    const res = findRooms(g, minArea, 0.42);
    attempts.push({ g, rooms: res.rooms, r });
    if (res.rooms.length > bestCount) bestCount = res.rooms.length;
    if (r >= 2 && res.rooms.length < bestCount * 0.6) break;
    if (r === 0 && res.rooms.length > 0) break; // closed drawing — no gap closing needed
  }
  for (const a of attempts) if (a.rooms.length === bestCount && bestCount > 0) { chosen = a; break; }
  let gapClosing = 0;
  if (chosen) gapClosing = chosen.r;
  if (chosen && chosen.r > 0) chosen = refineToWalls(chosen, buildGrid(0));
  if (gapClosing > 0) warn("info", `Small gaps in the wall lines were closed (${round(gapClosing * c, 2)} m tolerance) to detect rooms. Check the room outlines.`);

  // --- build rooms
  const rooms: PlanRoom[] = [];
  const labelToRoom = new Map<number, string>();
  let g: Grid;
  if (chosen) {
    g = chosen.g;
  } else {
    g = attempts[0].g;
  }
  const texts = doc.prims
    .filter((p): p is Extract<DxfPrim, { k: "text" }> => p.k === "text" && roleOf.get(p.layer) !== "dimension")
    .map((t) => ({ at: toM(t.at), s: t.s.trim(), h: t.h * f, rot: t.rot, layer: t.layer }))
    .filter((t) => t.s);

  if (chosen) {
    const raw = chosen.rooms.map((r) => {
      const ring = traceRing(g, r.label, r.bounds);
      const poly = cleanRing(simplifyRing(ring, c * 0.8), 1e-6);
      return { r, poly: poly.length >= 3 ? poly : ring };
    });
    raw.sort((a, b) => {
      const ca = centroid(a.poly), cb = centroid(b.poly);
      return Math.abs(ca[1] - cb[1]) > 1.5 ? cb[1] - ca[1] : ca[0] - cb[0];
    });
    raw.forEach(({ r, poly }, i) => {
      const id = `R${i + 1}`;
      labelToRoom.set(r.label, id);
      const bb = bboxOf(poly);
      const cen = centroid(poly);
      const inside = texts.filter((t) => inPoly(t.at, poly) && !isAreaLabel(t.s) && /[A-Za-zÀ-ž]{2}/.test(t.s));
      inside.sort((a, b) => dist(a.at, cen) - dist(b.at, cen));
      const nm = inside[0] ? truncate(inside[0].s.replace(/\s+/g, " ")) : null;
      const area = r.cells * c * c;
      const minW = Math.min(bb[2] - bb[0], bb[3] - bb[1]);
      const cls = classifyRoom(nm, area, minW, Math.max(bb[2] - bb[0], bb[3] - bb[1]));
      rooms.push({
        id, name: nm, label_source: nm ? "text" : "inferred", type: cls.type,
        polygon: poly.map((p) => roundPt(p)), area_m2: round(area, 2), centroid: roundPt(cen), bbox: bb.map((v) => round(v)) as BBox,
        function: FUNCTION_TEXT[cls.type], min_width_m: round(minW, 2),
      });
    });
  }
  const outsideLabel = g.outside;
  const labelAt = (p: Pt): string | "OUT" | null => {
    const [x, y] = cellOf(g, p);
    if (!inGrid(g, x, y)) return "OUT";
    const l = g.lbl[y * g.w + x];
    if (!l) return null;
    if (l === outsideLabel) return "OUT";
    return labelToRoom.get(l) ?? null;
  };

  let confidence: PlanAnalysis["confidence"] = "high";
  if (!rooms.length) {
    // Fallback: treat the building footprint as a single space so the engineer still gets a plan to work with.
    const poly: Pt[] = [[wallBox[0], wallBox[1]], [wallBox[2], wallBox[1]], [wallBox[2], wallBox[3]], [wallBox[0], wallBox[3]]];
    const area = (wallBox[2] - wallBox[0]) * (wallBox[3] - wallBox[1]);
    rooms.push({ id: "R1", name: null, label_source: "inferred", type: "room", polygon: poly.map((p) => roundPt(p)), area_m2: round(area, 2), centroid: roundPt(centroid(poly)), bbox: wallBox.map((v) => round(v)) as BBox, function: FUNCTION_TEXT.room, min_width_m: round(Math.min(wallBox[2] - wallBox[0], wallBox[3] - wallBox[1]), 2) });
    warn("critical", "No enclosed rooms could be detected — the wall lines are not closed. The building footprint is used as a single space; check the drawing or draw the missing walls.");
    confidence = "low";
  } else if (scale.assumed || wallsAssumed || gapClosing >= 4) confidence = "medium";

  const unlabeled = rooms.filter((r) => !r.name).length;
  if (rooms.length && unlabeled) warn("info", `${unlabeled} of ${rooms.length} room(s) have no label in the drawing; their function was inferred from size and shape.`);

  // --- walls (exterior / interior, thickness by parallel pairing)
  const delta = Math.max(0.12, c * 2.5 + (gapClosing ? gapClosing * c : 0));
  const wallRecs: PlanWall[] = wallSegs.map((s, i) => {
    const mid = lerp(s.a, s.b, 0.5);
    const n = perp(norm(sub(s.b, s.a)));
    const ext = labelAt([mid[0] + n[0] * delta, mid[1] + n[1] * delta]) === "OUT" || labelAt([mid[0] - n[0] * delta, mid[1] - n[1] * delta]) === "OUT";
    return { id: `WL${i + 1}`, a: roundPt(s.a), b: roundPt(s.b), layer: s.layer, exterior: ext && rooms.length > 0 && confidence !== "low", thickness_m: null };
  });
  {
    // pair parallel segments → thickness; exterior flag is shared inside a pair
    const cell = 1;
    const grid = new Map<string, number[]>();
    wallSegs.forEach((s, i) => {
      const m = lerp(s.a, s.b, 0.5);
      const key = `${Math.floor(m[0] / cell)}|${Math.floor(m[1] / cell)}`;
      grid.set(key, [...(grid.get(key) ?? []), i]);
    });
    wallSegs.forEach((s, i) => {
      const dirA = norm(sub(s.b, s.a));
      const m = lerp(s.a, s.b, 0.5);
      const ix = Math.floor(m[0] / cell), iy = Math.floor(m[1] / cell);
      let best: { j: number; d: number } | null = null;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${ix + dx}|${iy + dy}`) ?? []) {
          if (j === i) continue;
          const t = wallSegs[j];
          const dirB = norm(sub(t.b, t.a));
          if (Math.abs(dirA[0] * dirB[0] + dirA[1] * dirB[1]) < 0.9994) continue;
          const nrm = perp(dirA);
          const d = Math.abs((m[0] - t.a[0]) * nrm[0] + (m[1] - t.a[1]) * nrm[1]);
          if (d < 0.05 || d > 0.6) continue;
          const pr = distToSegment(m, t.a, t.b);
          if (pr.d > 0.65) continue;
          if (!best || d < best.d) best = { j, d };
        }
      }
      if (best) {
        wallRecs[i].thickness_m = round(best.d, 3);
        if (wallRecs[best.j].exterior) wallRecs[i].exterior = true;
      }
    });
  }

  // --- finalize openings (rooms on both sides, swing)
  const openings: PlanOpening[] = [];
  let dN = 0, wN = 0;
  for (const o of rawOpenings) {
    const n = perp(o.dir!);
    let a: string | "OUT" | null = null, b: string | "OUT" | null = null;
    for (const off of [0.45, 0.65, 0.9, 1.2]) {
      a = labelAt([o.center[0] + n[0] * off, o.center[1] + n[1] * off]);
      b = labelAt([o.center[0] - n[0] * off, o.center[1] - n[1] * off]);
      if (a && b) break;
    }
    if (!a && !b) continue;
    const between: [string | null, string | null] = [a === "OUT" ? null : a, b === "OUT" ? null : b];
    const exterior = a === "OUT" || b === "OUT";
    if (a === b && a !== "OUT") continue; // sits inside one room — furniture block, not an opening
    const rec: PlanOpening = {
      id: o.type === "door" ? `D${++dN}` : `W${++wN}`, type: o.type, at: roundPt(o.center), width_m: round(o.width, 2), angle: round(Math.atan2(o.dir![1], o.dir![0]), 4),
      layer: o.layer, block: o.block, between, exterior,
    };
    if (o.hinge && o.swingMid) {
      const into = labelAt(o.swingMid);
      rec.swing = {
        hinge: roundPt(o.hinge), toward: roundPt(o.swingMid), open_to: into === "OUT" ? null : into,
        description: into === "OUT" ? "opens outwards" : into ? `opens into ${into}` : "swing direction unknown",
      };
    }
    openings.push(rec);
  }
  if (!openings.some((o) => o.type === "door")) warn("warning", "No doors were detected. Room connections and switch positions rely on doors — check that doors are on a door layer or block.");

  // --- stairs
  const stairs: PlanStair[] = [];
  {
    const ss = toSegs(doc.prims, f, (p) => roleOf.get(p.layer) === "stairs");
    const parent = ss.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      if (distToSegment(ss[i].a, ss[j].a, ss[j].b).d < 0.5 || distToSegment(ss[i].b, ss[j].a, ss[j].b).d < 0.5) parent[find(i)] = find(j);
    }
    const groups = new Map<number, Seg[]>();
    ss.forEach((s, i) => { const k = find(i); groups.set(k, [...(groups.get(k) ?? []), s]); });
    for (const gr of groups.values()) {
      const bb = bboxOf(gr.flatMap((s) => [s.a, s.b]));
      if (Math.max(bb[2] - bb[0], bb[3] - bb[1]) < 0.8) continue;
      stairs.push({ id: `ST${stairs.length + 1}`, at: roundPt([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]), bbox: bb.map((v) => round(v)) as BBox, layer: gr[0].layer });
    }
    for (const ins of doc.inserts) {
      if ((roleOf.get(ins.layer) === "stairs" || roleOfName(ins.name) === "stairs") && ins.bbox) {
        const bb: BBox = [ins.bbox[0] * f, ins.bbox[1] * f, ins.bbox[2] * f, ins.bbox[3] * f];
        if (!stairs.some((s) => dist(s.at, [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]) < 1)) stairs.push({ id: `ST${stairs.length + 1}`, at: roundPt([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]), bbox: bb.map((v) => round(v)) as BBox, layer: ins.layer });
      }
    }
  }

  // --- dimension cross-check
  const withBoth = doc.dimensions.filter((d) => d.measurement !== null && d.geometric !== null && d.geometric > 0);
  let dimCheck: PlanAnalysis["dimension_check"] = { checked: 0, consistent: null, note: "No dimension annotations in the drawing; scale could not be cross-checked." };
  if (withBoth.length) {
    const bad = withBoth.filter((d) => Math.abs(d.measurement! / d.geometric! - 1) > 0.05).length;
    const consistent = bad / withBoth.length < 0.3;
    dimCheck = { checked: withBoth.length, consistent, note: consistent ? `${withBoth.length} dimension annotation(s) match the measured geometry.` : `${bad} of ${withBoth.length} dimension annotation(s) differ from the measured geometry — the drawing may use an annotation scale.` };
    if (!consistent) warn("warning", dimCheck.note);
  }

  // --- layers + preview
  const layers: PlanLayerInfo[] = [...counts.entries()].map(([name, entities]) => ({ name, role: role(name), entities })).sort((a, b) => b.entities - a.entities);
  const preview: PreviewPrim[] = [];
  for (const w of wallRecs) preview.push({ k: "line", role: "wall", v: [w.a[0], w.a[1], w.b[0], w.b[1]] });
  const keepRoles = new Set<LayerRole>(["door", "window", "stairs"]);
  for (const p of doc.prims) {
    const r = role(p.layer);
    if (r === "wall") continue;
    if (keepRoles.has(r)) {
      if (p.k === "seg") preview.push({ k: "line", role: r, v: [p.a[0] * f, p.a[1] * f, p.b[0] * f, p.b[1] * f].map((v) => round(v)) });
      else if (p.k === "arc") preview.push({ k: "arc", role: r, v: [p.c[0] * f, p.c[1] * f, p.r * f, p.a0, p.a1].map((v) => round(v, 4)) });
    }
  }
  const others = toSegs(doc.prims, f, (p) => p.k === "seg" && !["wall", "door", "window", "stairs", "text", "dimension"].includes(role(p.layer)))
    .sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b)).slice(0, 2500);
  for (const s of others) preview.push({ k: "line", role: "other", v: [s.a[0], s.a[1], s.b[0], s.b[1]].map((v) => round(v)) });

  // largest-first cap keeps the saved analysis small
  const walls = wallRecs.length > 2500 ? [...wallRecs].sort((a, b) => dist(b.a, b.b) - dist(a.a, a.b)).slice(0, 2500) : wallRecs;

  return {
    analysed_at: new Date().toISOString(),
    scale, extents: wallBox.map((v) => round(v)) as BBox, layers, walls, openings, rooms, stairs,
    stats: { entities: doc.entityCount, dimensions: doc.dimensions.length, texts: texts.length, blocks: doc.blockCount, wall_segments: wallSegs.length },
    dimension_check: dimCheck, confidence, walls_layer_assumed: wallsAssumed,
    preview: preview.length > 9000 ? preview.slice(0, 9000) : preview, warnings,
  };
}
