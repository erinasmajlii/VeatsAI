import type { BBox, Pt } from "./types";

export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export function norm(a: Pt): Pt {
  const l = len(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
}
export const perp = (a: Pt): Pt => [-a[1], a[0]];
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const round = (n: number, d = 3) => {
  const k = 10 ** d;
  return Math.round(n * k) / k;
};
export const roundPt = (p: Pt, d = 3): Pt => [round(p[0], d), round(p[1], d)];

export function bboxOf(pts: Pt[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Signed polygon area (positive = counter-clockwise). */
export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
export const polyArea = (poly: Pt[]) => Math.abs(signedArea(poly));

export function centroid(poly: Pt[]): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const b = bboxOf(poly);
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Ray-casting point-in-polygon. */
export function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number; q: Pt } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q: Pt = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { d: dist(p, q), t, q };
}

export function distToPolyEdges(p: Pt, poly: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, distToSegment(p, poly[i], poly[(i + 1) % poly.length]).d);
  return m;
}

/** Proper segment intersection (excluding touching end points within eps). */
export function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt, eps = 1e-9): boolean {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

export function pathLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Douglas–Peucker simplification of an open polyline. */
export function simplifyOpen(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let md = 0, mi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(pts[k], pts[i], pts[j]).d;
      if (d > md) { md = d; mi = k; }
    }
    if (mi >= 0 && md > eps) {
      keep[mi] = 1;
      stack.push([i, mi], [mi, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring: split at the two most distant vertices and simplify both halves. */
export function simplifyRing(ring: Pt[], eps: number): Pt[] {
  if (ring.length < 5) return ring.slice();
  let bi = 0, bj = 0, bd = -1;
  const step = Math.max(1, Math.floor(ring.length / 64));
  for (let i = 0; i < ring.length; i += step) for (let j = i + 1; j < ring.length; j += step) {
    const d = dist(ring[i], ring[j]);
    if (d > bd) { bd = d; bi = i; bj = j; }
  }
  const a = ring.slice(Math.min(bi, bj), Math.max(bi, bj) + 1);
  const b = [...ring.slice(Math.max(bi, bj)), ...ring.slice(0, Math.min(bi, bj) + 1)];
  const sa = simplifyOpen(a, eps);
  const sb = simplifyOpen(b, eps);
  return [...sa.slice(0, -1), ...sb.slice(0, -1)];
}

/** Remove duplicate and collinear vertices of a closed ring. */
export function cleanRing(ring: Pt[], collinearEps = 1e-6): Pt[] {
  let out = ring.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    const n = out.length;
    const next: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const p = out[(i + n - 1) % n], c = out[i], q = out[(i + 1) % n];
      if (dist(p, c) < 1e-9 || Math.abs(cross(sub(c, p), sub(q, c))) <= collinearEps * Math.max(1, dist(p, c) * dist(c, q))) { changed = true; continue; }
      next.push(c);
    }
    out = next;
  }
  return out;
}

/** Whether the segment p→q stays inside the polygon (sampled). */
export function segmentInside(poly: Pt[], p: Pt, q: Pt, step = 0.1): boolean {
  const n = Math.max(2, Math.ceil(dist(p, q) / step));
  for (let i = 0; i <= n; i++) if (!inPoly(lerp(p, q, i / n), poly)) return false;
  return true;
}

export function arcPoints(c: Pt, r: number, a0: number, a1: number, maxStepRad = Math.PI / 18): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil(sweep / maxStepRad));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}
