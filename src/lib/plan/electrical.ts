import {
  dist, distToPolyEdges, distToSegment, inPoly, norm, pathLength, perp, round, roundPt, segmentInside, signedArea, sub,
} from "./geom";
import type {
  DeviceKind, ElectricalCircuit, ElectricalConfig, ElectricalDevice, ElectricalPlan, LegendItem, PlanAnalysis, PlanBomLine, PlanOpening,
  PlanRoom, PlanWarning, Pt, RoomType,
} from "./types";

/**
 * Electrical plan generator (deterministic, rule based).
 *
 * Devices are placed from the real room polygons and door positions of the analysed plan:
 * luminaires on a lattice inside each room, switches at the latch side of each door, sockets spread along
 * the walls (never in a door opening), dedicated points for fixed appliances. Circuits are grouped by
 * proximity to the panel and cables are routed inside rooms and through the door openings — never through
 * walls. Output is PRELIMINARY: every value is a rule of thumb that the engineer reviews and approves.
 */

export const DEFAULT_ELECTRICAL_CONFIG: Omit<ElectricalConfig, "supply"> & { supply: ElectricalConfig["supply"] | "auto" } = {
  lighting: true, switches: true, sockets: true, special_sockets: true, points: true, supply: "auto", voltage_v: 230, luminaire_w: 18,
};

interface RoomRule {
  lightM2: number; // floor area served by one luminaire
  socketsPerM2: number; // 0 = fixed count only
  socketMin: number;
  socketMax: number;
  wet?: boolean;
}
const RULES: Record<RoomType, RoomRule> = {
  office: { lightM2: 6, socketsPerM2: 0.25, socketMin: 2, socketMax: 16 },
  meeting: { lightM2: 6, socketsPerM2: 0.33, socketMin: 2, socketMax: 10 },
  kitchen: { lightM2: 5, socketsPerM2: 0, socketMin: 4, socketMax: 6, wet: true },
  bathroom: { lightM2: 4, socketsPerM2: 0, socketMin: 1, socketMax: 1, wet: true },
  bedroom: { lightM2: 8, socketsPerM2: 0, socketMin: 4, socketMax: 6 },
  living: { lightM2: 7, socketsPerM2: 0.12, socketMin: 5, socketMax: 10 },
  corridor: { lightM2: 8, socketsPerM2: 0.1, socketMin: 1, socketMax: 3 },
  entrance: { lightM2: 8, socketsPerM2: 0, socketMin: 1, socketMax: 2 },
  storage: { lightM2: 12, socketsPerM2: 0, socketMin: 1, socketMax: 2 },
  garage: { lightM2: 12, socketsPerM2: 0, socketMin: 2, socketMax: 3 },
  technical: { lightM2: 8, socketsPerM2: 0, socketMin: 3, socketMax: 4 },
  laundry: { lightM2: 6, socketsPerM2: 0, socketMin: 3, socketMax: 3, wet: true },
  terrace: { lightM2: 10, socketsPerM2: 0, socketMin: 1, socketMax: 1, wet: true },
  stairs: { lightM2: 8, socketsPerM2: 0, socketMin: 0, socketMax: 0 },
  room: { lightM2: 8, socketsPerM2: 0.16, socketMin: 2, socketMax: 10 },
};

interface SpecialSpec { description: string; rating: string; load_w: number; protection: string; csa: number; cable: string; cos: number }
const SP: Record<string, SpecialSpec> = {
  cooker: { description: "Cooker / hob", rating: "32 A", load_w: 6500, protection: "MCB 1P C32 A", csa: 6, cable: "Cu 3×6 mm²", cos: 1 },
  dishwasher: { description: "Dishwasher", rating: "16 A", load_w: 2000, protection: "MCB 1P C16 A", csa: 2.5, cable: "NYM-J 3×2.5 mm²", cos: 0.9 },
  fridge: { description: "Refrigerator", rating: "16 A", load_w: 400, protection: "MCB 1P C16 A", csa: 2.5, cable: "NYM-J 3×2.5 mm²", cos: 0.9 },
  heater: { description: "Water heater", rating: "16 A", load_w: 2000, protection: "MCB 1P C16 A", csa: 2.5, cable: "NYM-J 3×2.5 mm²", cos: 1 },
  washer: { description: "Washing machine", rating: "16 A", load_w: 2200, protection: "MCB 1P C16 A", csa: 2.5, cable: "NYM-J 3×2.5 mm²", cos: 0.9 },
  rack: { description: "Server / IT rack", rating: "16 A", load_w: 2000, protection: "MCB 1P C16 A", csa: 2.5, cable: "NYM-J 3×2.5 mm²", cos: 0.9 },
  ac: { description: "Air-conditioning unit", rating: "16 A", load_w: 2500, protection: "MCB 1P C16 A", csa: 2.5, cable: "NYM-J 3×2.5 mm²", cos: 0.9 },
};

const STANDARDS = ["IEC 60364", "IEC 60947", "IEC 61439", "IEC 60529", "IEC 60228"];

// ------------------------------------------------------------------ geometry helpers

function ccw(poly: Pt[]): Pt[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Wall run: edge index, start/end and unit inward normal. */
function edgesOf(poly: Pt[]) {
  const p = ccw(poly);
  const out: { a: Pt; b: Pt; len: number; dir: Pt; inward: Pt }[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const len = dist(a, b);
    if (len < 0.01) continue;
    const dir = norm(sub(b, a));
    let inward: Pt = [-dir[1], dir[0]];
    const probe: Pt = [a[0] + dir[0] * len / 2 + inward[0] * 0.15, a[1] + dir[1] * len / 2 + inward[1] * 0.15];
    if (!inPoly(probe, poly)) inward = [-inward[0], -inward[1]];
    out.push({ a, b, len, dir, inward });
  }
  return out;
}

/** Positions along the usable wall length (door openings excluded), evenly spread. */
function wallPositions(room: PlanRoom, openings: PlanOpening[], n: number, offset = 0.14, phase = 0.5): { at: Pt; facing: Pt }[] {
  if (n <= 0) return [];
  const edges = edgesOf(room.polygon).filter((e) => e.len >= 0.6);
  const doors = openings.filter((o) => o.type === "door" && (o.between[0] === room.id || o.between[1] === room.id));
  type Run = { e: (typeof edges)[number]; t0: number; t1: number };
  const runs: Run[] = [];
  for (const e of edges) {
    const blocked: [number, number][] = [];
    for (const d of doors) {
      const r = distToSegment(d.at, e.a, e.b);
      if (r.d < d.width_m / 2 + 0.45) blocked.push([r.t * e.len - d.width_m / 2 - 0.35, r.t * e.len + d.width_m / 2 + 0.35]);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    let cur = 0.3;
    for (const [b0, b1] of blocked) {
      if (b0 - cur >= 0.4) runs.push({ e, t0: cur, t1: b0 });
      cur = Math.max(cur, b1);
    }
    if (e.len - 0.3 - cur >= 0.4) runs.push({ e, t0: cur, t1: e.len - 0.3 });
  }
  const total = runs.reduce((s, r) => s + (r.t1 - r.t0), 0);
  if (total < 0.4) return [];
  const out: { at: Pt; facing: Pt }[] = [];
  for (let k = 0; k < n; k++) {
    let s = ((k + phase) / n) * total;
    for (const r of runs) {
      const l = r.t1 - r.t0;
      if (s <= l + 1e-9) {
        const t = r.t0 + s;
        out.push({ at: [r.e.a[0] + r.e.dir[0] * t + r.e.inward[0] * offset, r.e.a[1] + r.e.dir[1] * t + r.e.inward[1] * offset], facing: r.e.inward });
        break;
      }
      s -= l;
    }
  }
  return out;
}

function luminairePositions(room: PlanRoom, n: number): Pt[] {
  const [x0, y0, x1, y1] = room.bbox;
  const w = x1 - x0, h = y1 - y0;
  const ok = (p: Pt, clr: number) => inPoly(p, room.polygon) && distToPolyEdges(p, room.polygon) >= clr;
  const lattice = (nx: number, ny: number, clr: number) => {
    const pts: Pt[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p: Pt = [x0 + (w * (i + 0.5)) / nx, y0 + (h * (j + 0.5)) / ny];
      if (ok(p, clr)) pts.push(p);
    }
    return pts;
  };
  let nx = Math.max(1, Math.round(Math.sqrt((n * w) / Math.max(h, 0.1))));
  nx = Math.min(nx, n);
  let ny = Math.max(1, Math.ceil(n / nx));
  let pts = lattice(nx, ny, 0.25);
  if (pts.length < Math.ceil(n * 0.7)) {
    // non-rectangular room: sample the polygon on a finer lattice
    const step = Math.sqrt(room.area_m2 / Math.max(n, 1));
    nx = Math.max(1, Math.ceil(w / step)); ny = Math.max(1, Math.ceil(h / step));
    const fine = lattice(nx, ny, 0.3);
    if (fine.length > pts.length) pts = fine;
  }
  if (!pts.length) {
    // pole of inaccessibility (coarse): the interior point farthest from all walls
    let best: Pt = room.centroid, bd = -1;
    for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
      const p: Pt = [x0 + (w * (i + 0.5)) / 12, y0 + (h * (j + 0.5)) / 12];
      if (!inPoly(p, room.polygon)) continue;
      const d = distToPolyEdges(p, room.polygon);
      if (d > bd) { bd = d; best = p; }
    }
    pts = [best];
  }
  return pts.slice(0, Math.max(n, 1));
}

/** Shortest path inside a (possibly non-convex) room polygon via a visibility graph over reflex corners. */
function routeInRoom(poly: Pt[], p: Pt, q: Pt): Pt[] {
  if (dist(p, q) < 1e-6) return [p];
  // orthogonal runs read like real cable routes: straight when aligned, otherwise a single elbow
  if (Math.abs(p[0] - q[0]) < 0.02 || Math.abs(p[1] - q[1]) < 0.02) { if (segmentInside(poly, p, q)) return [p, q]; }
  for (const elbow of [[q[0], p[1]], [p[0], q[1]]] as Pt[]) {
    if (segmentInside(poly, p, elbow) && segmentInside(poly, elbow, q)) return [p, elbow, q];
  }
  if (segmentInside(poly, p, q)) return [p, q];
  const pp = ccw(poly);
  const nodes: Pt[] = [p, q];
  for (let i = 0; i < pp.length; i++) {
    const a = pp[(i + pp.length - 1) % pp.length], v = pp[i], b = pp[(i + 1) % pp.length];
    const cr = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]);
    if (cr < -1e-6) {
      const n1 = norm(sub(v, a)), n2 = norm(sub(b, v));
      const bis = norm([-(n1[1] + n2[1]), n1[0] + n2[0]]);
      let cand: Pt = [v[0] + bis[0] * 0.18, v[1] + bis[1] * 0.18];
      if (!inPoly(cand, poly)) cand = [v[0] - bis[0] * 0.18, v[1] - bis[1] * 0.18];
      if (inPoly(cand, poly)) nodes.push(cand);
    }
  }
  const n = nodes.length;
  const D = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  D[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || D[i] < D[u])) u = i;
    if (u < 0 || D[u] === Infinity) break;
    done[u] = true;
    if (u === 1) break;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const w = dist(nodes[u], nodes[v]);
      if (D[u] + w < D[v] && segmentInside(poly, nodes[u], nodes[v], 0.15)) { D[v] = D[u] + w; prev[v] = u; }
    }
  }
  if (prev[1] < 0) return [p, q];
  const path: Pt[] = [];
  for (let v = 1; v >= 0; v = prev[v]) { path.unshift(nodes[v]); if (v === 0) break; }
  return path;
}

// ------------------------------------------------------------------ generator

export type ElectricalRequest = Omit<Partial<ElectricalConfig>, "supply"> & { supply?: ElectricalConfig["supply"] | "auto" };

export function generateElectrical(a: PlanAnalysis, cfgIn: ElectricalRequest = {}, now = new Date().toISOString()): ElectricalPlan {
  const base = { ...DEFAULT_ELECTRICAL_CONFIG, ...cfgIn };
  const warnings: PlanWarning[] = [];
  let wn = 0;
  const warn = (severity: PlanWarning["severity"], message: string) => warnings.push({ id: `ew${++wn}`, severity, message });
  const assumptions: string[] = [];

  const rooms = a.rooms;
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const doors = a.openings.filter((o) => o.type === "door");
  const devices: ElectricalDevice[] = [];
  const counters: Record<string, number> = {};
  const nextTag = (prefix: string) => `${prefix}${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;
  const mk = (kind: DeviceKind, prefix: string, at: Pt, room: PlanRoom | null, description: string, extra: Partial<ElectricalDevice> = {}): ElectricalDevice => {
    const d: ElectricalDevice = { id: `${prefix}${counters[prefix] ?? 0}`, kind, tag: nextTag(prefix), at: roundPt(at, 3), room_id: room?.id ?? null, circuit: null, description, ...extra };
    d.id = d.tag;
    devices.push(d);
    return d;
  };

  // ---- panel: inside the room behind the main entrance, next to the door
  const exteriorDoors = doors.filter((d) => d.exterior);
  let panelRoom: PlanRoom | undefined;
  let entryDoor: PlanOpening | undefined = exteriorDoors[0];
  if (entryDoor) panelRoom = roomById.get(entryDoor.between[0] ?? entryDoor.between[1] ?? "");
  if (!panelRoom) {
    panelRoom = rooms.find((r) => r.type === "technical") ?? rooms.find((r) => r.type === "corridor" || r.type === "entrance") ?? [...rooms].sort((x, y) => y.area_m2 - x.area_m2)[0];
    entryDoor = doors.find((d) => d.between.includes(panelRoom!.id));
    warn("warning", "No exterior door was detected; the distribution board was placed in " + (panelRoom.name ?? panelRoom.id) + ". Confirm its position.");
  }
  let panelPos: Pt = panelRoom.centroid;
  let panelFacing: Pt = [0, 1];
  {
    // candidate spots along the usable wall (door openings excluded); take the nearest one beside the entrance
    const ref: Pt = entryDoor ? entryDoor.at : panelRoom.centroid;
    const minGap = entryDoor ? entryDoor.width_m / 2 + 0.6 : 0;
    const cands = wallPositions(panelRoom, a.openings, 40, 0.2, 0.5);
    let best: { at: Pt; facing: Pt } | null = null, bd = Infinity;
    for (const c of cands) {
      const d = dist(c.at, ref);
      if (d >= minGap && d < bd) { bd = d; best = c; }
    }
    if (best) { panelPos = best.at; panelFacing = best.facing; }
  }
  const panel: ElectricalDevice = { id: "DB1", kind: "panel", tag: "DB1", at: roundPt(panelPos), room_id: panelRoom.id, circuit: null, description: "Distribution board", facing: panelFacing };
  const panelRoomId = panelRoom.id;

  // ---- lighting
  const lumByRoom = new Map<string, ElectricalDevice[]>();
  if (base.lighting) {
    for (const r of rooms) {
      if (r.type === "stairs") continue;
      const rule = RULES[r.type];
      const n = Math.min(60, Math.max(1, Math.ceil(r.area_m2 / rule.lightM2)));
      const arr: ElectricalDevice[] = [];
      for (const p of luminairePositions(r, n)) arr.push(mk("luminaire", "L", p, r, `Ceiling luminaire ${base.luminaire_w} W`, { rating: `${base.luminaire_w} W` }));
      lumByRoom.set(r.id, arr);
    }
  }

  // ---- switches
  const swByRoom = new Map<string, ElectricalDevice[]>();
  if (base.switches && base.lighting) {
    for (const r of rooms) {
      const rDoors = doors.filter((d) => d.between.includes(r.id));
      if (!rDoors.length) continue;
      let chosen = rDoors;
      if (r.type === "corridor" || r.type === "entrance") {
        const [bx0, by0, bx1, by1] = r.bbox;
        const alongX = bx1 - bx0 >= by1 - by0;
        const key = (d: PlanOpening) => (alongX ? d.at[0] : d.at[1]);
        const sorted = [...rDoors].sort((x, y) => key(x) - key(y));
        chosen = [...new Set([sorted[0], sorted[sorted.length - 1], ...rDoors.filter((d) => d.exterior)])];
      } else if (rDoors.length > 2) chosen = [...rDoors].sort((x, y) => dist(x.at, r.centroid) - dist(y.at, r.centroid)).slice(0, 2);
      const arr: ElectricalDevice[] = [];
      for (const d of chosen) {
        const dir = norm([Math.cos(d.angle), Math.sin(d.angle)]);
        const n = perp(dir);
        // latch side = opposite to the hinge
        let side = 1;
        if (d.swing) side = (d.at[0] - d.swing.hinge[0]) * dir[0] + (d.at[1] - d.swing.hinge[1]) * dir[1] >= 0 ? 1 : -1;
        let placed: Pt | null = null;
        let facing: Pt = n;
        for (const lat of [0.3, 0.45]) {
          for (const sgn of [1, -1]) {
            for (const depth of [0.18, 0.3, 0.45]) {
              const p: Pt = [d.at[0] + dir[0] * side * (d.width_m / 2 + lat) + n[0] * sgn * depth, d.at[1] + dir[1] * side * (d.width_m / 2 + lat) + n[1] * sgn * depth];
              if (inPoly(p, r.polygon) && distToPolyEdges(p, r.polygon) >= 0.05) { placed = p; facing = [n[0] * sgn, n[1] * sgn]; break; }
            }
            if (placed) break;
          }
          if (placed) break;
        }
        if (!placed) { warn("info", `Could not place a switch for door ${d.id} in ${r.name ?? r.id}.`); continue; }
        arr.push(mk("switch", "SW", placed, r, `Light switch (${r.name ?? r.id}, door ${d.id})`, { facing, rating: "10 A" }));
      }
      swByRoom.set(r.id, arr);
    }
  }

  // ---- sockets, special sockets, data points
  const sockByRoom = new Map<string, ElectricalDevice[]>();
  const specialDevices: { dev: ElectricalDevice; spec: SpecialSpec }[] = [];
  const dataPoints: ElectricalDevice[] = [];
  const outdoorLights: ElectricalDevice[] = [];
  for (const r of rooms) {
    const rule = RULES[r.type];
    const nameLc = (r.name ?? "").toLowerCase();
    let nSock = base.sockets ? Math.min(rule.socketMax, Math.max(rule.socketMin, Math.ceil(r.area_m2 * rule.socketsPerM2))) : 0;
    const specials: SpecialSpec[] = [];
    if (base.special_sockets) {
      if (r.type === "kitchen") specials.push(SP.cooker, SP.dishwasher, SP.fridge);
      else if (r.type === "bathroom" && r.area_m2 >= 3) specials.push(SP.heater);
      else if (r.type === "laundry") specials.push(SP.washer);
      else if (r.type === "technical") { const k = /server|it|data/.test(nameLc) ? 2 : 1; for (let i = 0; i < k; i++) specials.push(SP.rack); }
      if (["office", "meeting", "living", "bedroom"].includes(r.type) && r.area_m2 >= 25) for (let i = 0; i < Math.min(3, Math.floor(r.area_m2 / 25)); i++) specials.push(SP.ac);
    }
    const total = nSock + specials.length;
    if (total) {
      const pos = wallPositions(r, a.openings, total, 0.14, 0.5);
      if (pos.length < total) warn("info", `${r.name ?? r.id}: only ${pos.length} of ${total} wall outlets fit the available wall length.`);
      nSock = Math.min(nSock, pos.length);
      const arr: ElectricalDevice[] = [];
      pos.slice(0, nSock).forEach((p) => arr.push(mk("socket", "S", p.at, r, rule.wet ? "Socket 16 A (IP44, RCD protected)" : "Socket 16 A", { facing: p.facing, rating: "16 A" })));
      sockByRoom.set(r.id, arr);
      specials.forEach((spec, i) => {
        const p = pos[nSock + i] ?? pos[pos.length - 1];
        if (!p) return;
        specialDevices.push({ dev: mk("special_socket", "X", p.at, r, `${spec.description} point ${spec.rating}`, { facing: p.facing, rating: spec.rating }), spec });
      });
    }
    if (base.points) {
      let nData = 0;
      if (r.type === "office") nData = Math.min(10, Math.max(1, Math.ceil(r.area_m2 / 8)));
      else if (r.type === "meeting") nData = 2;
      else if (r.type === "living" || r.type === "bedroom") nData = 1;
      else if (r.type === "technical" && /server|it|data/.test(nameLc)) nData = 2;
      if (nData) wallPositions(r, a.openings, nData, 0.14, 0.2).forEach((p) => dataPoints.push(mk("point", "P", p.at, r, "Data outlet (RJ45)", { facing: p.facing })));
    }
  }
  if (base.points && base.lighting) {
    for (const d of exteriorDoors) {
      const dir = norm([Math.cos(d.angle), Math.sin(d.angle)]);
      const n = perp(dir);
      const roomSide = d.between[0] ?? d.between[1];
      const inRoom = roomSide ? roomById.get(roomSide) : null;
      // outside = the side that is not inside a room
      const probe: Pt = [d.at[0] + n[0] * 0.6, d.at[1] + n[1] * 0.6];
      const outsideDir: Pt = inRoom && inPoly(probe, inRoom.polygon) ? [-n[0], -n[1]] : n;
      const p: Pt = [d.at[0] + outsideDir[0] * 0.6 + dir[0] * (d.width_m / 2 + 0.2), d.at[1] + outsideDir[1] * 0.6 + dir[1] * (d.width_m / 2 + 0.2)];
      outdoorLights.push(mk("point", "P", p, inRoom ?? null, "Outdoor luminaire (IP65) at entrance", { facing: outsideDir, rating: `${base.luminaire_w} W` }));
    }
  }

  // ---- circuits
  const circuits: ElectricalCircuit[] = [];
  const byDevice = (ids: string[]) => devices.filter((d) => ids.includes(d.id));
  const distFromPanel = (r: PlanRoom) => dist(r.centroid, panel.at);
  const orderedRooms = [...rooms].sort((x, y) => distFromPanel(x) - distFromPanel(y));

  const newCircuit = (kind: ElectricalCircuit["kind"], name: string, protection: string, cable: string, csa: number, loadW: number, cos: number, ids: string[], phaseIdx: number): ElectricalCircuit => {
    const id = `C${circuits.length + 1}`;
    const phases: ElectricalCircuit["phase"][] = ["L1", "L2", "L3"];
    const c: ElectricalCircuit = {
      id, kind, name, phase: phases[phaseIdx % 3], protection, cable, cable_csa_mm2: csa, load_w: Math.round(loadW),
      design_current_a: 0, device_ids: ids, route: [], length_m: 0, rooms: [...new Set(byDevice(ids).map((d) => d.room_id).filter((x): x is string => !!x))],
    };
    circuits.push(c);
    for (const d of devices) if (ids.includes(d.id)) d.circuit = id;
    c.design_current_a = round(loadW / (base.voltage_v * cos), 1);
    return c;
  };

  // provisional totals to resolve the supply
  const lumTotal = [...lumByRoom.values()].reduce((s, l) => s + l.length, 0) + outdoorLights.length;
  const sockTotal = [...sockByRoom.values()].reduce((s, l) => s + l.length, 0);
  const specialLoad = specialDevices.reduce((s, x) => s + x.spec.load_w, 0);
  const demand = lumTotal * base.luminaire_w + sockTotal * 350 * 0.5 + specialLoad * 0.6;
  const supply: ElectricalConfig["supply"] = base.supply === "auto" ? (demand > 12000 ? "three_phase" : "single_phase") : base.supply;
  if (base.supply === "auto") assumptions.push(`Supply selected from the estimated demand (${round(demand / 1000, 1)} kW): ${supply === "three_phase" ? "three-phase 400/230 V" : "single-phase 230 V"}.`);

  let ph = 0;
  const LIGHT_CAP = 12;
  {
    // lighting circuits: fill by room, nearest rooms to the panel first
    let curLum: ElectricalDevice[] = [], curSw: ElectricalDevice[] = [];
    const flush = () => {
      if (!curLum.length) return;
      const ids = [...curLum, ...curSw].map((d) => d.id);
      const rs = [...new Set(curLum.map((d) => roomById.get(d.room_id ?? "")?.name ?? d.room_id))].slice(0, 3).join(", ");
      newCircuit("lighting", `Lighting — ${rs}`, "MCB 1P B10 A", "NYM-J 3×1.5 mm²", 1.5, curLum.length * base.luminaire_w, 0.95, ids, ph++);
      curLum = []; curSw = [];
    };
    for (const r of orderedRooms) {
      const lums = lumByRoom.get(r.id) ?? [];
      const sws = swByRoom.get(r.id) ?? [];
      if (curLum.length && curLum.length + lums.length > LIGHT_CAP) flush();
      for (let i = 0; i < lums.length; i += LIGHT_CAP) {
        if (curLum.length && curLum.length + Math.min(LIGHT_CAP, lums.length - i) > LIGHT_CAP) flush();
        curLum.push(...lums.slice(i, i + LIGHT_CAP));
        if (i === 0) curSw.push(...sws);
        if (curLum.length >= LIGHT_CAP) flush();
      }
      if (!lums.length && sws.length) curSw.push(...sws);
    }
    // outdoor entrance lights share the first lighting circuit when there is one
    flush();
    if (outdoorLights.length) {
      const first = circuits.find((c) => c.kind === "lighting");
      if (first) {
        first.device_ids.push(...outdoorLights.map((d) => d.id));
        outdoorLights.forEach((d) => (d.circuit = first.id));
        first.load_w += outdoorLights.length * base.luminaire_w;
        first.design_current_a = round(first.load_w / (base.voltage_v * 0.95), 1);
      } else newCircuit("lighting", "Lighting — entrance", "MCB 1P B10 A", "NYM-J 3×1.5 mm²", 1.5, outdoorLights.length * base.luminaire_w, 0.95, outdoorLights.map((d) => d.id), ph++);
    }
  }
  {
    // socket circuits: wet rooms on their own circuit, others ≤ 8 outlets
    const wetIds: string[] = [];
    let cur: ElectricalDevice[] = [];
    const flush = () => {
      if (!cur.length) return;
      const rs = [...new Set(cur.map((d) => roomById.get(d.room_id ?? "")?.name ?? d.room_id))].slice(0, 3).join(", ");
      newCircuit("sockets", `Sockets — ${rs}`, "MCB 1P C16 A", "NYM-J 3×2.5 mm²", 2.5, Math.min(cur.length * 350, 2800), 0.9, cur.map((d) => d.id), ph++);
      cur = [];
    };
    for (const r of orderedRooms) {
      const socks = sockByRoom.get(r.id) ?? [];
      if (!socks.length) continue;
      if (RULES[r.type].wet) { wetIds.push(...socks.map((d) => d.id)); continue; }
      for (let i = 0; i < socks.length; i += 8) {
        const chunk = socks.slice(i, i + 8);
        if (cur.length && cur.length + chunk.length > 8) flush();
        cur.push(...chunk);
        if (cur.length >= 8) flush();
      }
    }
    flush();
    if (wetIds.length) {
      const ds = byDevice(wetIds);
      for (let i = 0; i < ds.length; i += 6) {
        const chunk = ds.slice(i, i + 6);
        const rs = [...new Set(chunk.map((d) => roomById.get(d.room_id ?? "")?.name ?? d.room_id))].slice(0, 3).join(", ");
        newCircuit("sockets", `Sockets (wet areas) — ${rs}`, "MCB 1P C16 A", "NYM-J 3×2.5 mm²", 2.5, Math.min(chunk.length * 350, 2800), 0.9, chunk.map((d) => d.id), ph++);
      }
    }
    for (const { dev, spec } of specialDevices) {
      newCircuit("special", `${spec.description} — ${roomById.get(dev.room_id ?? "")?.name ?? dev.room_id}`, spec.protection, spec.cable, spec.csa, spec.load_w, spec.cos, [dev.id], ph++);
    }
  }

  for (const c of circuits) {
    const inC = Number(/C(\d+)|B(\d+)/.exec(c.protection)?.slice(1).find(Boolean));
    if (inC && c.design_current_a > inC) warn("critical", `Circuit ${c.id}: design current ${c.design_current_a} A exceeds its ${inC} A protection — split the circuit.`);
  }

  // ---- routing (inside rooms + through doors only)
  const adj = new Map<string, { door: PlanOpening; to: string }[]>();
  for (const d of doors) {
    const [x, y] = d.between;
    if (x && y) {
      adj.set(x, [...(adj.get(x) ?? []), { door: d, to: y }]);
      adj.set(y, [...(adj.get(y) ?? []), { door: d, to: x }]);
    }
  }
  const doorsBetween = (from: string, to: string): { door: PlanOpening; from: string; to: string }[] | null => {
    if (from === to) return [];
    const prev = new Map<string, { door: PlanOpening; from: string }>();
    const q = [from];
    const seen = new Set([from]);
    while (q.length) {
      const u = q.shift()!;
      for (const e of adj.get(u) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, { door: e.door, from: u });
        if (e.to === to) { q.length = 0; break; }
        q.push(e.to);
      }
    }
    if (!prev.has(to)) return null;
    const path: { door: PlanOpening; from: string; to: string }[] = [];
    for (let v = to; v !== from; v = prev.get(v)!.from) path.unshift({ door: prev.get(v)!.door, from: prev.get(v)!.from, to: v });
    return path;
  };
  const doorPoint = (d: PlanOpening, inRoom: PlanRoom): Pt => {
    const n = perp(norm([Math.cos(d.angle), Math.sin(d.angle)]));
    for (const off of [0.3, 0.45, 0.6]) for (const s of [1, -1]) {
      const p: Pt = [d.at[0] + n[0] * s * off, d.at[1] + n[1] * s * off];
      if (inPoly(p, inRoom.polygon)) return p;
    }
    return d.at;
  };
  let routeIssues = 0;
  const connect = (p: Pt, rp: string, q: Pt, rq: string): Pt[] => {
    const A = roomById.get(rp), B = roomById.get(rq);
    if (!A || !B) return [p, q];
    const hops = doorsBetween(rp, rq);
    if (!hops) { routeIssues++; return [p, q]; }
    if (!hops.length) return routeInRoom(A.polygon, p, q);
    const out: Pt[] = [];
    let cur = p;
    for (const h of hops) {
      const from = roomById.get(h.from)!, to = roomById.get(h.to)!;
      const exit = doorPoint(h.door, from);
      const enter = doorPoint(h.door, to);
      out.push(...routeInRoom(from.polygon, cur, exit), enter);
      cur = enter;
    }
    out.push(...routeInRoom(B.polygon, cur, q));
    return out;
  };
  for (const c of circuits) {
    const nodes = byDevice(c.device_ids);
    const remaining = [...nodes];
    let cur: { at: Pt; room: string } = { at: panel.at, room: panelRoomId };
    const route: Pt[] = [panel.at];
    while (remaining.length) {
      let bi = 0, bd = Infinity;
      remaining.forEach((d, i) => { const dd = dist(cur.at, d.at) + (d.room_id === cur.room ? 0 : 3); if (dd < bd) { bd = dd; bi = i; } });
      const next = remaining.splice(bi, 1)[0];
      const leg = connect(cur.at, cur.room, next.at, next.room_id ?? cur.room);
      for (const pt of leg) if (!route.length || dist(route[route.length - 1], pt) > 1e-6) route.push(pt);
      cur = { at: next.at, room: next.room_id ?? cur.room };
    }
    c.route = route.map((p) => roundPt(p, 3));
    c.length_m = round(pathLength(route), 1);
  }
  if (routeIssues) warn("warning", `${routeIssues} cable run(s) join rooms that are not connected by a detected door; they are drawn as straight lines and must be checked.`);

  // ---- loads, main protection, BOM
  const lightingW = circuits.filter((c) => c.kind === "lighting").reduce((s, c) => s + c.load_w, 0);
  const socketW = circuits.filter((c) => c.kind === "sockets").reduce((s, c) => s + c.load_w, 0);
  const specialW = circuits.filter((c) => c.kind === "special").reduce((s, c) => s + c.load_w, 0);
  const connectedW = lightingW + socketW + specialW;
  const demandW = lightingW + socketW * 0.5 + specialW * 0.6;
  const ib = supply === "three_phase" ? demandW / (Math.sqrt(3) * 400 * 0.95) : demandW / (base.voltage_v * 0.95);
  const sizes = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125];
  const inMain = sizes.find((s) => s >= ib) ?? 125;
  const mainProt = supply === "three_phase" ? `MCB 3P C${inMain} A + RCCB 4P ${Math.max(40, Math.min(inMain, 63))} A 30 mA` : `MCB 2P C${inMain} A + RCCB 2P ${Math.max(40, Math.min(inMain, 63))} A 30 mA`;
  if (supply === "single_phase" && ib > 63) warn("warning", `Estimated demand current is ${round(ib, 0)} A — a three-phase supply is recommended.`);

  assumptions.push(
    "TN-S earthing system, 230 V single-phase circuits at 50 Hz (assumed — confirm with the utility).",
    `Luminaires ${base.luminaire_w} W LED; sockets 0.35 kW each (max 2.8 kW per 16 A circuit, ≤ 8 outlets); demand factors 1.0 lighting / 0.5 sockets / 0.6 fixed appliances.`,
    "Cable routes follow rooms and door openings; vertical drops, conduit and cable-tray choices are left to the installer.",
    "Device positions follow common practice (switches at the latch side of doors, sockets spread along walls). They are preliminary and require engineer review.",
  );
  if (a.scale.assumed) assumptions.push(a.scale.note);

  const cabByCsa = (csa: number) => circuits.filter((c) => c.cable_csa_mm2 === csa);
  const meters = (csa: number) => {
    const cs = cabByCsa(csa);
    const drops = cs.reduce((s, c) => s + 5 + byDevice(c.device_ids).reduce((x, d) => x + (d.kind === "luminaire" ? 0.8 : 2.2), 0), 0);
    return Math.ceil(cs.reduce((s, c) => s + c.length_m, 0) * 1.1 + drops);
  };
  const nLight = circuits.filter((c) => c.kind === "lighting").length;
  const n16 = circuits.filter((c) => c.protection.includes("C16")).length;
  const n32 = circuits.filter((c) => c.protection.includes("C32")).length;
  const modules = circuits.length + 4 * Math.max(1, Math.ceil(circuits.length / 6)) + (supply === "three_phase" ? 3 : 2) + 2;
  const count = (k: DeviceKind) => devices.filter((d) => d.kind === k).length;
  const cableTotal = meters(1.5) + meters(2.5) + meters(6);
  const bom: PlanBomLine[] = [];
  const line = (id: string, description: string, sku: string | null, quantity: number, unit: string, basis: string) => { if (quantity > 0) bom.push({ id, description, sku, quantity, unit, basis }); };
  line("cable15", "NYM-J cable 3×1.5 mm² (lighting)", "CABL-NYM-3X1.5", meters(1.5), "meter", "Routed length +10 % plus vertical drops and panel tails");
  line("cable25", "NYM-J cable 3×2.5 mm² (sockets, appliances)", "CABL-NYM-3X2.5", meters(2.5), "meter", "Routed length +10 % plus vertical drops and panel tails");
  line("cable6", "Power cable for 32 A circuits (5×6 mm² used as 3-core)", "CABL-NYY-5X6", meters(6), "meter", "Dedicated 32 A circuits; the stocked 6 mm² cable is 5-core");
  line("mcb16", "MCB 1P C16 A", "PROT-MCB-001", n16, "pcs", "One per 16 A circuit");
  line("mcb10", "MCB 1P B10 A (lighting)", null, nLight, "pcs", "Not in the stock catalogue — to be purchased");
  line("mcb32", "MCB 1P C32 A (cooker)", null, n32, "pcs", "Not in the stock catalogue — to be purchased");
  line("rccb", "RCCB 4P 40 A 30 mA", "PROT-RCD-001", Math.max(1, Math.ceil(circuits.length / 6)), "pcs", "One RCD per group of up to 6 circuits");
  line("main", `Main protection ${mainProt.split(" + ")[0]}`, supply === "three_phase" ? (inMain <= 32 ? "PROT-MCB-002" : "PROT-MCCB-001") : null, 1, "pcs", supply === "three_phase" ? "Incoming device" : "Not in the stock catalogue — to be purchased");
  line("enclosure", "Distribution board enclosure", modules <= 24 ? "ENC-SCH-6040" : "ENC-RIT-8010", 1, "pcs", `${modules} modules estimated`);
  line("din", "DIN rail 35 mm", "MNT-DIN-35", Math.max(1, Math.ceil(modules / 24)), "pcs", "One rail per 24 modules");
  line("terminals", "Terminal block 2.5 mm²", "CONN-TRM-2.5", circuits.length * 2 + 10, "pcs", "Two per circuit plus neutral/PE bars");
  line("wago", "Splicing connector 3-wire", "CONN-WAG-221", Math.ceil(devices.length / 2), "pcs", "One per two devices");
  line("ties", "Cable ties (pack of 100)", "CONS-TIE-200", Math.max(1, Math.ceil(cableTotal / 80)), "pack", "One pack per 80 m of cable");
  line("lum", `Luminaire ${base.luminaire_w} W`, null, count("luminaire"), "pcs", "Not stocked — to be purchased");
  line("sw", "Light switch", null, count("switch"), "pcs", "Not stocked — to be purchased");
  line("sock", "Socket 16 A", null, count("socket"), "pcs", "Not stocked — to be purchased");
  line("xsock", "Appliance connection point", null, count("special_socket"), "pcs", "Not stocked — to be purchased");
  line("data", "Data outlet (RJ45)", null, devices.filter((d) => d.description.startsWith("Data")).length, "pcs", "Not stocked — to be purchased");
  line("outdoor", "Outdoor luminaire (IP65)", null, outdoorLights.length, "pcs", "Not stocked — to be purchased");

  const legend: LegendItem[] = [
    { kind: "luminaire", label: "Ceiling luminaire", count: count("luminaire") },
    { kind: "switch", label: "Light switch", count: count("switch") },
    { kind: "socket", label: "Socket 16 A", count: count("socket") },
    { kind: "special_socket", label: "Appliance point", count: count("special_socket") },
    { kind: "point", label: "Data / outdoor point", count: count("point") },
    { kind: "panel", label: "Distribution board", count: 1 },
    { kind: "cable", label: "Cable route", count: circuits.length },
  ].filter((l) => l.count > 0) as LegendItem[];

  if (rooms.length === 1 && rooms[0].label_source === "inferred" && a.confidence === "low") warn("critical", "Rooms were not detected, so devices are placed in the building footprint only.");
  warn("info", "Preliminary design — requires engineer review and approval.");

  return {
    generated_at: now,
    config: { lighting: base.lighting, switches: base.switches, sockets: base.sockets, special_sockets: base.special_sockets, points: base.points, supply, voltage_v: base.voltage_v, luminaire_w: base.luminaire_w },
    panel, devices, circuits, legend,
    technical: {
      voltage_v: supply === "three_phase" ? 400 : base.voltage_v, system: supply === "three_phase" ? "TN-S, 400/230 V three-phase" : "TN-S, 230 V single-phase", frequency_hz: 50, standards: STANDARDS,
      connected_load_w: Math.round(connectedW), demand_load_w: Math.round(demandW), design_current_a: round(ib, 1), main_protection: mainProt, cable_total_m: cableTotal,
    },
    assumptions, bom, warnings,
  };
}
