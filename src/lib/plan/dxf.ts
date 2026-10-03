import { arcPoints, bboxOf } from "./geom";
import type { BBox, Pt } from "./types";

/**
 * ASCII DXF reader.
 *
 * Reads the entities of the drawing (LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, SOLID, TEXT, MTEXT,
 * DIMENSION, INSERT) and flattens block references so every primitive is expressed in model space.
 * Geometry stays in DRAWING UNITS here; unit conversion happens in the analysis step.
 */

export type DxfPrim =
  | { k: "seg"; a: Pt; b: Pt; layer: string }
  | { k: "arc"; c: Pt; r: number; a0: number; a1: number; layer: string }
  | { k: "circle"; c: Pt; r: number; layer: string }
  | { k: "text"; at: Pt; h: number; s: string; rot: number; layer: string };

export interface DxfLayer {
  name: string;
  color: number;
  visible: boolean;
}

export interface DxfInsert {
  name: string;
  at: Pt;
  rot: number;
  sx: number;
  sy: number;
  layer: string;
  /** Bounding box of the block geometry after the insert transform (drawing units). */
  bbox: BBox | null;
  prims: number;
}

export interface DxfDimension {
  measurement: number | null;
  geometric: number | null;
  text: string;
}

export interface DxfDoc {
  version: string | null;
  insUnits: number | null;
  measurement: number | null;
  layers: Map<string, DxfLayer>;
  prims: DxfPrim[];
  inserts: DxfInsert[];
  dimensions: DxfDimension[];
  entityCount: number;
  blockCount: number;
}

export class DxfError extends Error {
  constructor(
    message: string,
    public code: "BINARY" | "EMPTY" | "INVALID" = "INVALID",
  ) {
    super(message);
  }
}

const DWG_VERSIONS: Record<string, string> = {
  AC1006: "R10", AC1009: "R11/R12", AC1012: "R13", AC1014: "R14", AC1015: "2000", AC1018: "2004",
  AC1021: "2007", AC1024: "2010", AC1027: "2013", AC1032: "2018",
};
export const dwgVersion = (buf: Uint8Array): string | null => {
  const tag = Buffer.from(buf.subarray(0, 6)).toString("latin1");
  return /^AC\d{4}$/.test(tag) ? (DWG_VERSIONS[tag] ?? tag) : null;
};
export const isBinaryDxf = (buf: Uint8Array) => Buffer.from(buf.subarray(0, 22)).toString("latin1") === "AutoCAD Binary DXF\r\n" || Buffer.from(buf.subarray(0, 18)).toString("latin1") === "AutoCAD Binary DXF";

export function decodeDxf(buf: Uint8Array): string {
  const b = Buffer.from(buf);
  const utf8 = b.toString("utf8");
  return utf8.includes("�") ? b.toString("latin1") : utf8;
}

type Pair = [number, string];

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\n|\r/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isNaN(code)) {
      // Tolerate a stray blank line by resynchronising once.
      if (lines[i].trim() === "") { i -= 1; continue; }
      throw new DxfError(`Unexpected content at line ${i + 1}: not a DXF group code.`);
    }
    out.push([code, lines[i + 1]]);
  }
  return out;
}

const num = (v: string | undefined, d = 0) => {
  if (v === undefined) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const DEG = Math.PI / 180;

interface RawEntity {
  type: string;
  layer: string;
  seq: Pair[];
}
const first = (e: RawEntity, code: number) => e.seq.find((p) => p[0] === code)?.[1];
const all = (e: RawEntity, code: number) => e.seq.filter((p) => p[0] === code).map((p) => p[1]);

function cleanMtext(s: string): string {
  return s
    .replace(/\\P/gi, " ")
    .replace(/\{\\[^;}]*;/g, "")
    .replace(/\\[A-Za-z][^;\\]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\~/g, " ")
    .replace(/\\\\/g, "\\")
    .trim();
}
const cleanText = (s: string) =>
  s.replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%[cC]/g, "⌀").replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).trim();

/** Tessellate the bulge arc between two polyline vertices. */
function bulgePoints(p: Pt, q: Pt, bulge: number): Pt[] {
  if (Math.abs(bulge) < 1e-9) return [p, q];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (chord < 1e-12) return [p, q];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const dir: Pt = [(q[0] - p[0]) / chord, (q[1] - p[1]) / chord];
  const nrm: Pt = [-dir[1], dir[0]];
  const sgn = bulge > 0 ? 1 : -1;
  const c: Pt = [mid[0] + nrm[0] * h * sgn * (Math.abs(theta) > Math.PI ? -1 : 1), mid[1] + nrm[1] * h * sgn * (Math.abs(theta) > Math.PI ? -1 : 1)];
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (theta * i) / n;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  pts[0] = p;
  pts[pts.length - 1] = q;
  return pts;
}

function polyPrims(verts: { p: Pt; b: number }[], closed: boolean, layer: string): DxfPrim[] {
  const out: DxfPrim[] = [];
  const n = verts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const v = verts[i], w = verts[(i + 1) % n];
    const pts = bulgePoints(v.p, w.p, v.b);
    for (let k = 1; k < pts.length; k++) out.push({ k: "seg", a: pts[k - 1], b: pts[k], layer });
  }
  return out;
}

function entityToPrims(e: RawEntity): { prims: DxfPrim[]; dim?: DxfDimension } {
  const L = e.layer;
  switch (e.type) {
    case "LINE": {
      const a: Pt = [num(first(e, 10)), num(first(e, 20))];
      const b: Pt = [num(first(e, 11)), num(first(e, 21))];
      return { prims: [{ k: "seg", a, b, layer: L }] };
    }
    case "LWPOLYLINE": {
      const verts: { p: Pt; b: number }[] = [];
      let cur: { p: Pt; b: number } | null = null;
      for (const [c, v] of e.seq) {
        if (c === 10) { cur = { p: [num(v), 0], b: 0 }; verts.push(cur); }
        else if (c === 20 && cur) cur.p[1] = num(v);
        else if (c === 42 && cur) cur.b = num(v);
      }
      const closed = (parseInt(first(e, 70) ?? "0", 10) & 1) === 1;
      return { prims: polyPrims(verts, closed, L) };
    }
    case "ARC": {
      const c: Pt = [num(first(e, 10)), num(first(e, 20))];
      return { prims: [{ k: "arc", c, r: num(first(e, 40)), a0: num(first(e, 50)) * DEG, a1: num(first(e, 51)) * DEG, layer: L }] };
    }
    case "CIRCLE": {
      const c: Pt = [num(first(e, 10)), num(first(e, 20))];
      return { prims: [{ k: "circle", c, r: num(first(e, 40)), layer: L }] };
    }
    case "SOLID": {
      const p = [10, 11, 13, 12].map((o) => [num(first(e, o)), num(first(e, o + 10))] as Pt);
      const prims: DxfPrim[] = [];
      for (let i = 0; i < 4; i++) prims.push({ k: "seg", a: p[i], b: p[(i + 1) % 4], layer: L });
      return { prims };
    }
    case "TEXT": {
      const s = first(e, 1);
      if (!s) return { prims: [] };
      const align = parseInt(first(e, 72) ?? "0", 10) + parseInt(first(e, 73) ?? "0", 10);
      const at: Pt = align > 0 && first(e, 11) !== undefined ? [num(first(e, 11)), num(first(e, 21))] : [num(first(e, 10)), num(first(e, 20))];
      return { prims: [{ k: "text", at, h: num(first(e, 40), 1), s: cleanText(s), rot: num(first(e, 50)) * DEG, layer: L }] };
    }
    case "MTEXT": {
      const s = all(e, 3).join("") + (first(e, 1) ?? "");
      if (!s) return { prims: [] };
      const rot = first(e, 11) !== undefined ? Math.atan2(num(first(e, 21)), num(first(e, 11))) : num(first(e, 50)) * DEG;
      return { prims: [{ k: "text", at: [num(first(e, 10)), num(first(e, 20))], h: num(first(e, 40), 1), s: cleanText(cleanMtext(s)), rot, layer: L }] };
    }
    case "DIMENSION": {
      const type = parseInt(first(e, 70) ?? "0", 10) & 7;
      const m = first(e, 42);
      let geometric: number | null = null;
      if (type === 0 || type === 1) {
        const p13: Pt = [num(first(e, 13)), num(first(e, 23))];
        const p14: Pt = [num(first(e, 14)), num(first(e, 24))];
        const d = Math.hypot(p14[0] - p13[0], p14[1] - p13[1]);
        if (type === 1) geometric = d;
        else {
          const ang = num(first(e, 50)) * DEG;
          geometric = Math.abs((p14[0] - p13[0]) * Math.cos(ang) + (p14[1] - p13[1]) * Math.sin(ang));
        }
      }
      return { prims: [], dim: { measurement: m !== undefined ? num(m) : null, geometric, text: first(e, 1) ?? "" } };
    }
    default:
      return { prims: [] };
  }
}

interface Block {
  name: string;
  base: Pt;
  entities: RawEntity[];
}

/** Split a flat token stream into raw entities (handles POLYLINE/VERTEX/SEQEND grouping). */
function readEntities(pairs: Pair[], start: number, endTypes: Set<string>): { entities: RawEntity[]; next: number } {
  const entities: RawEntity[] = [];
  let i = start;
  let poly: RawEntity | null = null;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === 0) {
      if (endTypes.has(val)) break;
      const type = val;
      const seq: Pair[] = [];
      i++;
      while (i < pairs.length && pairs[i][0] !== 0) seq.push(pairs[i++]);
      const layer = seq.find((p) => p[0] === 8)?.[1] ?? "0";
      const ent: RawEntity = { type, layer, seq };
      if (type === "POLYLINE") { poly = ent; entities.push(ent); }
      else if (type === "VERTEX" && poly) poly.seq.push([0, "VERTEX"], ...seq);
      else if (type === "SEQEND") poly = null;
      else entities.push(ent);
    } else i++;
  }
  return { entities, next: i };
}

function polylineVerts(e: RawEntity): { verts: { p: Pt; b: number }[]; closed: boolean } | null {
  const flags = parseInt(first(e, 70) ?? "0", 10);
  if (flags & (16 | 64)) return null; // 3D mesh / polyface
  const verts: { p: Pt; b: number }[] = [];
  let cur: { p: Pt; b: number } | null = null;
  let inV = false;
  for (const [c, v] of e.seq) {
    if (c === 0 && v === "VERTEX") { cur = { p: [0, 0], b: 0 }; verts.push(cur); inV = true; continue; }
    if (!inV || !cur) continue;
    if (c === 10) cur.p[0] = num(v);
    else if (c === 20) cur.p[1] = num(v);
    else if (c === 42) cur.b = num(v);
  }
  return { verts, closed: (flags & 1) === 1 };
}

type Xf = { sx: number; sy: number; rot: number; at: Pt; base: Pt };
const applyXf = (p: Pt, t: Xf): Pt => {
  const x = (p[0] - t.base[0]) * t.sx;
  const y = (p[1] - t.base[1]) * t.sy;
  const c = Math.cos(t.rot), s = Math.sin(t.rot);
  return [t.at[0] + x * c - y * s, t.at[1] + x * s + y * c];
};

function transformPrim(q: DxfPrim, t: Xf, layerOf: (l: string) => string): DxfPrim[] {
  const layer = layerOf(q.layer);
  const uniform = Math.abs(Math.abs(t.sx) - Math.abs(t.sy)) < 1e-9 && t.sx * t.sy > 0;
  switch (q.k) {
    case "seg": return [{ k: "seg", a: applyXf(q.a, t), b: applyXf(q.b, t), layer }];
    case "text": {
      const p = applyXf(q.at, t);
      return [{ ...q, at: p, h: q.h * Math.abs(t.sy), rot: q.rot + t.rot, layer }];
    }
    case "circle": {
      if (uniform) return [{ k: "circle", c: applyXf(q.c, t), r: q.r * Math.abs(t.sx), layer }];
      const ring = arcPoints(q.c, q.r, 0, Math.PI * 2 - 1e-6).map((p) => applyXf(p, t));
      return ring.slice(1).map((p, i) => ({ k: "seg" as const, a: ring[i], b: p, layer }));
    }
    case "arc": {
      if (Math.abs(Math.abs(t.sx) - Math.abs(t.sy)) < 1e-9) {
        // Uniform scale, possibly mirrored: reflect the angular span, then rotate.
        let a0 = q.a0, a1 = q.a1;
        if (t.sy < 0) [a0, a1] = [-a1, -a0];
        if (t.sx < 0) [a0, a1] = [Math.PI - a1, Math.PI - a0];
        return [{ k: "arc", c: applyXf(q.c, t), r: q.r * Math.abs(t.sx), a0: a0 + t.rot, a1: a1 + t.rot, layer }];
      }
      const pts = arcPoints(q.c, q.r, q.a0, q.a1).map((p) => applyXf(p, t));
      return pts.slice(1).map((p, i) => ({ k: "seg" as const, a: pts[i], b: p, layer }));
    }
  }
}

export function parseDxf(text: string): DxfDoc {
  if (!/\bSECTION\b/.test(text) || !/\bEOF\b/.test(text)) throw new DxfError("This file is not a valid ASCII DXF drawing (missing SECTION / EOF).");
  const pairs = tokenize(text);
  const doc: DxfDoc = { version: null, insUnits: null, measurement: null, layers: new Map(), prims: [], inserts: [], dimensions: [], entityCount: 0, blockCount: 0 };
  const blocks = new Map<string, Block>();
  let entities: RawEntity[] = [];

  let i = 0;
  while (i < pairs.length) {
    if (!(pairs[i][0] === 0 && pairs[i][1] === "SECTION")) { i++; continue; }
    const name = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1] : "";
    i += 2;
    if (name === "HEADER") {
      let cur = "";
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
        const [c, v] = pairs[i];
        if (c === 9) cur = v;
        else if (cur === "$ACADVER" && c === 1) doc.version = v;
        else if (cur === "$INSUNITS" && c === 70) doc.insUnits = parseInt(v, 10);
        else if (cur === "$MEASUREMENT" && c === 70) doc.measurement = parseInt(v, 10);
        i++;
      }
    } else if (name === "TABLES") {
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
        if (pairs[i][0] === 0 && pairs[i][1] === "LAYER") {
          let lname = "0", color = 7, flags = 0;
          i++;
          while (i < pairs.length && pairs[i][0] !== 0) {
            const [c, v] = pairs[i++];
            if (c === 2) lname = v;
            else if (c === 62) color = parseInt(v, 10);
            else if (c === 70) flags = parseInt(v, 10);
          }
          doc.layers.set(lname, { name: lname, color: Math.abs(color), visible: color >= 0 && (flags & 1) === 0 });
        } else i++;
      }
    } else if (name === "BLOCKS") {
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
        if (pairs[i][0] === 0 && pairs[i][1] === "BLOCK") {
          i++;
          let bname = "", bx = 0, by = 0;
          while (i < pairs.length && pairs[i][0] !== 0) {
            const [c, v] = pairs[i++];
            if (c === 2 && !bname) bname = v;
            else if (c === 10) bx = num(v);
            else if (c === 20) by = num(v);
          }
          const r = readEntities(pairs, i, new Set(["ENDBLK", "ENDSEC"]));
          i = r.next;
          blocks.set(bname, { name: bname, base: [bx, by], entities: r.entities });
        } else i++;
      }
      doc.blockCount = [...blocks.keys()].filter((n) => !n.startsWith("*")).length;
    } else if (name === "ENTITIES") {
      const r = readEntities(pairs, i, new Set(["ENDSEC"]));
      entities = r.entities;
      i = r.next;
    } else {
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) i++;
    }
  }

  const layerVisible = (l: string) => doc.layers.get(l)?.visible !== false;

  const emit = (ents: RawEntity[], xf: Xf | null, parentLayer: string | null, depth: number, sink: DxfPrim[]) => {
    const layerOf = (l: string) => (l === "0" && parentLayer ? parentLayer : l);
    for (const e of ents) {
      doc.entityCount++;
      if (e.type === "INSERT") {
        if (depth >= 4) continue;
        const bname = first(e, 2) ?? "";
        const blk = blocks.get(bname);
        const eff = layerOf(e.layer);
        const at: Pt = [num(first(e, 10)), num(first(e, 20))];
        const sx = num(first(e, 41), 1) || 1;
        const sy = num(first(e, 42), 1) || 1;
        const rot = num(first(e, 50)) * DEG;
        const local: Xf = { sx, sy, rot, at, base: blk?.base ?? [0, 0] };
        // Compose with the parent transform by transforming the insert point and adding rotation/scale.
        const world: Xf = xf ? { sx: sx * xf.sx, sy: sy * xf.sy, rot: rot + xf.rot, at: applyXf(at, xf), base: local.base } : local;
        if (!blk) continue;
        const sub: DxfPrim[] = [];
        emit(blk.entities, world, eff, depth + 1, sub);
        if (depth === 0) {
          const pts: Pt[] = [];
          for (const q of sub) {
            if (q.k === "seg") pts.push(q.a, q.b);
            else if (q.k === "arc") pts.push(...arcPoints(q.c, q.r, q.a0, q.a1));
            else if (q.k === "circle") pts.push([q.c[0] - q.r, q.c[1] - q.r], [q.c[0] + q.r, q.c[1] + q.r]);
          }
          doc.inserts.push({ name: bname, at: world.at, rot: world.rot, sx: world.sx, sy: world.sy, layer: eff, bbox: pts.length ? bboxOf(pts) : null, prims: sub.length });
        }
        for (const q of sub) sink.push(q);
        continue;
      }
      let prims: DxfPrim[];
      let dim: DxfDimension | undefined;
      if (e.type === "POLYLINE") {
        const pv = polylineVerts(e);
        prims = pv ? polyPrims(pv.verts, pv.closed, e.layer) : [];
      } else ({ prims, dim } = entityToPrims(e));
      if (dim && depth === 0) doc.dimensions.push(dim);
      for (const q of prims) {
        if (xf) for (const t of transformPrim(q, xf, layerOf)) sink.push(t);
        else sink.push(q);
      }
    }
  };

  const all: DxfPrim[] = [];
  emit(entities, null, null, 0, all);
  doc.prims = all.filter((p) => layerVisible(p.layer));
  for (const p of doc.prims) if (!doc.layers.has(p.layer)) doc.layers.set(p.layer, { name: p.layer, color: 7, visible: true });
  if (!doc.prims.length && !doc.inserts.length) throw new DxfError("The drawing contains no readable geometry.", "EMPTY");
  return doc;
}
