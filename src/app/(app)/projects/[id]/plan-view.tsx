"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import type { ElectricalDevice, ElectricalPlan, PlanAnalysis, Pt } from "@/lib/plan/types";

/**
 * SVG drawing of the analysed architecture (walls, openings, room labels) and, optionally, the generated
 * electrical plan on top of it. Coordinates are the drawing's own (metres); y is flipped for the screen.
 * Wheel / pinch zoom, drag to pan.
 */

export type ViewMode = "architecture" | "electrical";
export interface PlanLayers {
  walls: boolean;
  openings: boolean;
  labels: boolean;
  cables: boolean;
}
export const DEFAULT_LAYERS: PlanLayers = { walls: true, openings: true, labels: true, cables: true };

const CIRCUIT_COLOR = { lighting: "var(--accent)", sockets: "var(--warning)", special: "#a855f7" } as const;
const DEVICE_COLOR: Record<ElectricalDevice["kind"], string> = { luminaire: "var(--accent)", switch: "var(--success)", socket: "var(--warning)", special_socket: "#a855f7", point: "#0891b2", panel: "var(--danger)" };

const Y = (y: number) => -y;
const poly = (pts: Pt[]) => pts.map(([x, y]) => `${x},${Y(y)}`).join(" ");

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a0 + sweep), y1 = cy + r * Math.sin(a0 + sweep);
  return `M${x0} ${Y(y0)} A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1} ${Y(y1)}`;
}

function Symbol({ d }: { d: ElectricalDevice }) {
  const [x, yy] = d.at;
  const y = Y(yy);
  const c = DEVICE_COLOR[d.kind];
  const f = d.facing ?? [0, 1];
  const fx = f[0], fy = -f[1]; // screen orientation of the facing vector
  const tx = -fy, ty = fx;
  const s = { stroke: c, strokeWidth: 1.4, fill: "none", vectorEffect: "non-scaling-stroke" } as const;
  const title = <title>{`${d.tag} — ${d.description}${d.circuit ? ` (${d.circuit})` : ""}`}</title>;
  switch (d.kind) {
    case "luminaire":
      return <g>{title}<circle cx={x} cy={y} r={0.15} {...s} fill="var(--card)" /><path d={`M${x - 0.1} ${y - 0.1}L${x + 0.1} ${y + 0.1}M${x - 0.1} ${y + 0.1}L${x + 0.1} ${y - 0.1}`} {...s} /></g>;
    case "switch":
      return <g>{title}<circle cx={x} cy={y} r={0.075} {...s} fill={c} /><path d={`M${x} ${y}L${x + (fx + tx) * 0.2} ${y + (fy + ty) * 0.2}`} {...s} /></g>;
    case "socket":
      return <g>{title}<circle cx={x} cy={y} r={0.1} {...s} fill="var(--card)" /><path d={`M${x - tx * 0.17 - fx * 0.1} ${y - ty * 0.17 - fy * 0.1}L${x + tx * 0.17 - fx * 0.1} ${y + ty * 0.17 - fy * 0.1}`} {...s} /></g>;
    case "special_socket":
      return <g>{title}<rect x={x - 0.12} y={y - 0.12} width={0.24} height={0.24} {...s} fill="var(--card)" /><circle cx={x} cy={y} r={0.055} {...s} /></g>;
    case "point":
      return d.description.startsWith("Outdoor")
        ? <g>{title}<circle cx={x} cy={y} r={0.12} {...s} fill="var(--card)" /><path d={`M${x - 0.18} ${y}H${x + 0.18}M${x} ${y - 0.18}V${y + 0.18}`} {...s} /></g>
        : <g>{title}<path d={`M${x - 0.13} ${y + 0.1}L${x + 0.13} ${y + 0.1}L${x} ${y - 0.13}Z`} {...s} fill="var(--card)" /></g>;
    case "panel": {
      const w = 0.6, h = 0.22;
      const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
      return <g>{title}<rect x={x - w / 2} y={y - h / 2} width={w} height={h} transform={`rotate(${ang} ${x} ${y})`} fill={c} stroke={c} strokeWidth={0.02} /><text x={x + fx * 0.55} y={y + fy * 0.55 + 0.1} fontSize={0.3} fontWeight={600} textAnchor="middle" fill={c}>DB1</text></g>;
    }
  }
}

export function PlanView({ analysis, electrical, mode, layers, className = "" }: { analysis: PlanAnalysis; electrical: ElectricalPlan | null; mode: ViewMode; layers: PlanLayers; className?: string }) {
  const t = useT();
  const [x0, y0, x1, y1] = analysis.extents;
  const pad = Math.max(1.5, (x1 - x0) * 0.04);
  const home = useMemo(() => ({ x: x0 - pad, y: Y(y1) - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }), [x0, y0, x1, y1, pad]);
  const [view, setView] = useState(home);
  const [lastHome, setLastHome] = useState(home);
  if (lastHome !== home) {
    setLastHome(home);
    setView(home);
  }
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // wheel zoom around the cursor (needs a non-passive listener)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = Math.exp(e.deltaY * 0.0015);
      setView((v) => {
        const mx = v.x + ((e.clientX - r.left) / r.width) * v.w;
        const my = v.y + ((e.clientY - r.top) / r.height) * v.h;
        const w = Math.min(Math.max(v.w * k, home.w / 40), home.w * 3);
        const h = (w / v.w) * v.h;
        return { x: mx - ((mx - v.x) / v.w) * w, y: my - ((my - v.y) / v.h) * h, w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [home.w]);

  function zoom(k: number) {
    setView((v) => {
      const w = Math.min(Math.max(v.w * k, home.w / 40), home.w * 3);
      const h = (w / v.w) * v.h;
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });
  }

  const labelSize = Math.max(0.22, (x1 - x0) / 95);
  const showElectrical = mode === "electrical" && electrical;
  const prim = analysis.preview;

  return (
    <div className={`relative overflow-hidden rounded-lg border border-border bg-white ${className}`}>
      <div
        ref={box}
        className="h-full min-h-[320px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !box.current) return;
          const r = box.current.getBoundingClientRect();
          setView((v) => ({ ...v, x: d.vx - ((e.clientX - d.x) / r.width) * v.w, y: d.vy - ((e.clientY - d.y) / r.height) * v.h }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => setView(home)}
      >
        {/* the sheet stays white in dark mode, like a printed drawing */}
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-full w-full" role="img" aria-label={t("plan.preview")} style={{ color: "#0e1621" }}>
          <g style={{ ["--card" as string]: "#ffffff", ["--foreground" as string]: "#0e1621", ["--accent" as string]: "#1f55c9", ["--warning" as string]: "#c2410c", ["--success" as string]: "#15803d", ["--danger" as string]: "#b3261e", ["--muted-foreground" as string]: "#64748b" }}>
            {analysis.rooms.map((r) => (
              <polygon key={r.id} points={poly(r.polygon)} fill="#1f55c9" fillOpacity={mode === "electrical" ? 0.025 : 0.05} stroke="none" />
            ))}
            {prim.filter((p) => p.role === "other").map((p, i) => (
              <line key={`o${i}`} x1={p.v[0]} y1={Y(p.v[1])} x2={p.v[2]} y2={Y(p.v[3])} stroke="#94a3b8" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {layers.walls && analysis.walls.map((w) => (
              <line key={w.id} x1={w.a[0]} y1={Y(w.a[1])} x2={w.b[0]} y2={Y(w.b[1])} stroke="#0e1621" strokeWidth={w.exterior ? 2.2 : 1.5} strokeLinecap="square" vectorEffect="non-scaling-stroke" />
            ))}
            {layers.openings && prim.filter((p) => p.role === "door" || p.role === "window" || p.role === "stairs").map((p, i) =>
              p.k === "line" ? (
                <line key={`d${i}`} x1={p.v[0]} y1={Y(p.v[1])} x2={p.v[2]} y2={Y(p.v[3])} stroke={p.role === "window" ? "#1f55c9" : p.role === "stairs" ? "#64748b" : "#15803d"} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              ) : p.k === "arc" ? (
                <path key={`d${i}`} d={arcPath(p.v[0], p.v[1], p.v[2], p.v[3], p.v[4])} fill="none" stroke="#15803d" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ) : null,
            )}
            {layers.labels && analysis.rooms.map((r) => (
              <g key={`l${r.id}`} textAnchor="middle" style={{ pointerEvents: "none" }}>
                <text x={r.centroid[0]} y={Y(r.centroid[1]) - labelSize * 0.1} fontSize={labelSize} fontWeight={600} fill="#334155">{r.name ?? r.id}</text>
                <text x={r.centroid[0]} y={Y(r.centroid[1]) + labelSize * 1.15} fontSize={labelSize * 0.85} fill="#64748b">{r.area_m2.toFixed(1)} m²</text>
              </g>
            ))}

            {showElectrical && layers.cables && electrical.circuits.map((c) => (
              <polyline key={c.id} points={poly(c.route)} fill="none" stroke={CIRCUIT_COLOR[c.kind]} strokeWidth={1.4} strokeDasharray="7 4" strokeOpacity={0.9} vectorEffect="non-scaling-stroke">
                <title>{`${c.id} — ${c.name} · ${c.protection} · ${c.cable} · ${c.length_m} m`}</title>
              </polyline>
            ))}
            {showElectrical && electrical.circuits.map((c) => {
              const m = c.route[Math.floor(c.route.length / 2)];
              return m ? <text key={`t${c.id}`} x={m[0] + 0.12} y={Y(m[1]) - 0.12} fontSize={labelSize * 0.9} fontWeight={700} fill={CIRCUIT_COLOR[c.kind]}>{c.id}</text> : null;
            })}
            {showElectrical && [...electrical.devices, electrical.panel].map((d) => <Symbol key={d.id} d={d} />)}
          </g>
        </svg>
      </div>
      <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-border bg-card text-foreground shadow-sm">
        <button type="button" onClick={() => zoom(0.75)} aria-label={t("plan.view.zoomIn")} className="grid h-8 w-8 place-items-center text-base hover:bg-muted">+</button>
        <button type="button" onClick={() => zoom(1.33)} aria-label={t("plan.view.zoomOut")} className="grid h-8 w-8 place-items-center border-y border-border text-base hover:bg-muted">−</button>
        <button type="button" onClick={() => setView(home)} aria-label={t("plan.view.reset")} title={t("plan.view.reset")} className="grid h-8 w-8 place-items-center text-[10px] font-medium hover:bg-muted">1:1</button>
      </div>
    </div>
  );
}

export function LegendSymbol({ kind }: { kind: ElectricalDevice["kind"] }) {
  const d: ElectricalDevice = { id: "", tag: "", kind, at: [0, 0], room_id: null, circuit: null, description: "", facing: [0, 1] };
  return (
    <svg viewBox="-0.35 -0.35 0.7 0.7" className="h-5 w-5 shrink-0" aria-hidden>
      <g style={{ ["--card" as string]: "#ffffff", ["--accent" as string]: "#1f55c9", ["--warning" as string]: "#c2410c", ["--success" as string]: "#15803d", ["--danger" as string]: "#b3261e" }}>
        <Symbol d={d} />
      </g>
    </svg>
  );
}
