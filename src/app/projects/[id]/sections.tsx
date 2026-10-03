"use client";

import { useMemo, useState } from "react";
import { ENVIRONMENT_LABEL, INSTALLATION_LABEL, STARTING_METHOD_LABEL } from "@/lib/engineering/constants";
import { CRITICAL_FIELDS, FIELD_LABEL } from "@/lib/engineering/inputs";
import type { StandardDefinition, StandardRule } from "@/lib/standards";
import type { BomLine, DesignInputs, MotorSpec, Product, ProductType, Project, TracedValue } from "@/lib/types";
import { Badge, Card, ProvenanceBadge, ResultStatusBadge, SeverityBadge, StockBadge, eur, fmtDate } from "@/components/ui";
import type { RunAction } from "./workspace";

// ------------------------------------------------------------------ AI analysis

export function AnalysisCard({ project }: { project: Project }) {
  const a = project.analysis;
  const [raw, setRaw] = useState(false);
  if (!a) return null;
  const critical = a.missing_information.filter((f) => (CRITICAL_FIELDS as readonly string[]).includes(f));
  const recommended = a.missing_information.filter((f) => !(CRITICAL_FIELDS as readonly string[]).includes(f));
  return (
    <Card
      title="AI Analysis"
      actions={a.source === "ai" ? <Badge t="violet" title={a.model}>AI generated</Badge> : <Badge t="amber">Rule-based parser (no AI)</Badge>}
      className="h-full"
    >
      <div className="space-y-4 p-5 text-sm">
        <div>
          <div className="label">Original request</div>
          <blockquote className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 font-mono text-[13px] text-slate-700">{project.original_request}</blockquote>
        </div>
        <div>
          <div className="label">AI interpretation</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Kv k="Project type" v={a.project_type.replace(/_/g, " ")} />
            <Kv k="Motors" v={a.motors.length ? a.motors.map((m) => `${m.quantity} × ${m.power_kw} kW`).join(", ") : "—"} />
            <Kv k="Voltage" v={a.voltage ? `${a.voltage} V` : "—"} />
            <Kv k="Starting method" v={a.starting_method ? STARTING_METHOD_LABEL[a.starting_method] : "—"} />
            <Kv k="Frequency" v={a.frequency ? `${a.frequency} Hz` : "—"} />
            <Kv k="Environment" v={a.environment ? ENVIRONMENT_LABEL[a.environment] : "—"} />
          </dl>
        </div>
        {a.missing_information.length > 0 && (
          <div>
            <div className="label">Missing information</div>
            <div className="flex flex-wrap gap-1.5">
              {critical.map((f) => <Badge key={f} t="red">{FIELD_LABEL[f] ?? f} (required)</Badge>)}
              {recommended.map((f) => <Badge key={f} t="amber">{FIELD_LABEL[f] ?? f}</Badge>)}
            </div>
          </div>
        )}
        {a.notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            {a.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        <button className="text-xs font-medium text-slate-500 hover:underline" onClick={() => setRaw(!raw)}>
          {raw ? "Hide" : "Show"} structured JSON
        </button>
        {raw && <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{JSON.stringify(a, null, 2)}</pre>}
      </div>
    </Card>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ inputs

type Form = {
  motors: MotorSpec[];
  voltage: string; frequency: string; power_factor: string; efficiency: string; starting_method: string;
  cable_length_m: string; environment: string; installation_method: string; ambient_temperature_c: string;
  short_circuit_current_ka: string; max_voltage_drop_pct: string;
};
const SCALAR_KEYS = ["voltage", "frequency", "power_factor", "efficiency", "starting_method", "cable_length_m", "environment", "installation_method", "ambient_temperature_c", "short_circuit_current_ka", "max_voltage_drop_pct"] as const;

function toForm(i: DesignInputs): Form {
  const s = (t: TracedValue<unknown>) => (t.value === null || t.value === undefined ? "" : String(t.value));
  return {
    motors: i.motors.map((m) => ({ ...m })),
    voltage: s(i.voltage), frequency: s(i.frequency), power_factor: s(i.power_factor), efficiency: s(i.efficiency),
    starting_method: s(i.starting_method), cable_length_m: s(i.cable_length_m), environment: s(i.environment),
    installation_method: s(i.installation_method), ambient_temperature_c: s(i.ambient_temperature_c),
    short_circuit_current_ka: s(i.short_circuit_current_ka), max_voltage_drop_pct: s(i.max_voltage_drop_pct),
  };
}

export function InputsCard({ project, busy, onGenerate, run }: { project: Project; busy: string | null; onGenerate: (patch: Record<string, unknown>) => Promise<boolean>; run: RunAction }) {
  const inputs = project.inputs!;
  const original = useMemo(() => toForm(inputs), [inputs]);
  const [f, setF] = useState<Form>(original);
  const [syncedFrom, setSyncedFrom] = useState(inputs);
  if (syncedFrom !== inputs) {
    setSyncedFrom(inputs);
    setF(toForm(inputs));
  }
  const hasDesign = !!project.design;

  const patch: Record<string, unknown> = {};
  if (JSON.stringify(f.motors) !== JSON.stringify(original.motors)) patch.motors = f.motors;
  for (const k of SCALAR_KEYS) if (f[k] !== original[k]) patch[k] = f[k] === "" ? null : f[k];
  const dirty = Object.keys(patch).length > 0;

  const missingCritical = [!f.motors.length || f.motors.some((m) => !(Number(m.power_kw) > 0)) ? "motors" : null, !f.voltage ? "voltage" : null, !f.starting_method ? "starting_method" : null].filter(Boolean);
  const set = (k: keyof Form, v: string) => setF({ ...f, [k]: v });
  const prov = (k: (typeof SCALAR_KEYS)[number]) => (f[k] !== original[k] ? <Badge t="orange">Edited</Badge> : <ProvenanceBadge p={inputs[k].provenance} />);
  const need = (k: string, critical = false) => (critical ? (missingCritical.includes(k) ? "border-red-400 bg-red-50" : "") : !f[k as keyof Form] ? "border-amber-300 bg-amber-50/50" : "");

  return (
    <Card
      title={hasDesign ? "Engineering inputs" : "Complete missing information"}
      actions={<span className="text-xs text-slate-500">Engineer can edit every value · defaults are shown as “Assumed value”</span>}
      className="h-full"
    >
      <div className="space-y-5 p-5">
        <div>
          <div className="label">Motors</div>
          <table className="tbl">
            <thead>
              <tr><th>Label</th><th>Quantity</th><th>Power (kW)</th><th></th></tr>
            </thead>
            <tbody>
              {f.motors.map((m, i) => (
                <tr key={i}>
                  <td><input className="input" value={m.label ?? ""} onChange={(e) => setF({ ...f, motors: f.motors.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
                  <td><input className="input" type="number" min={1} value={m.quantity} onChange={(e) => setF({ ...f, motors: f.motors.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)) })} /></td>
                  <td><input className="input" type="number" step="0.1" min={0.1} value={m.power_kw} onChange={(e) => setF({ ...f, motors: f.motors.map((x, j) => (j === i ? { ...x, power_kw: Number(e.target.value) } : x)) })} /></td>
                  <td className="text-right"><button className="text-xs text-red-600 hover:underline" onClick={() => setF({ ...f, motors: f.motors.filter((_, j) => j !== i) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="mt-2 text-xs font-medium text-slate-600 hover:underline" onClick={() => setF({ ...f, motors: [...f.motors, { quantity: 1, power_kw: 7.5, label: `M${f.motors.length + 1}` }] })}>
            + Add motor group
          </button>
          {missingCritical.includes("motors") && <p className="mt-1 text-xs text-red-600">Motor power and quantity are required.</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Supply voltage (V) *" badge={prov("voltage")}>
            <input className={`input ${need("voltage", true)}`} type="number" value={f.voltage} onChange={(e) => set("voltage", e.target.value)} placeholder="e.g. 400" />
          </Field>
          <Field label="Starting method *" badge={prov("starting_method")}>
            <select className={`input ${need("starting_method", true)}`} value={f.starting_method} onChange={(e) => set("starting_method", e.target.value)}>
              <option value="">— select —</option>
              {Object.entries(STARTING_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Frequency (Hz)" badge={prov("frequency")}>
            <select className="input" value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>
              <option value="50">50</option>
              <option value="60">60</option>
            </select>
          </Field>
          <Field label="Power factor (cos φ)" badge={prov("power_factor")}>
            <input className="input" type="number" step="0.01" value={f.power_factor} onChange={(e) => set("power_factor", e.target.value)} />
          </Field>
          <Field label="Efficiency (η)" badge={prov("efficiency")}>
            <input className="input" type="number" step="0.01" value={f.efficiency} onChange={(e) => set("efficiency", e.target.value)} />
          </Field>
          <Field label="Motor cable length (m)" badge={prov("cable_length_m")}>
            <input className={`input ${need("cable_length_m")}`} type="number" value={f.cable_length_m} onChange={(e) => set("cable_length_m", e.target.value)} placeholder="Not provided" />
          </Field>
          <Field label="Environment (IP rating)" badge={prov("environment")}>
            <select className={`input ${need("environment")}`} value={f.environment} onChange={(e) => set("environment", e.target.value)}>
              <option value="">Not specified</option>
              {Object.entries(ENVIRONMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Cable installation method" badge={prov("installation_method")}>
            <select className={`input ${need("installation_method")}`} value={f.installation_method} onChange={(e) => set("installation_method", e.target.value)}>
              <option value="">Not specified</option>
              {Object.entries(INSTALLATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Ambient temperature (°C)" badge={prov("ambient_temperature_c")}>
            <input className={`input ${need("ambient_temperature_c")}`} type="number" value={f.ambient_temperature_c} onChange={(e) => set("ambient_temperature_c", e.target.value)} placeholder="Not provided (30 °C ref.)" />
          </Field>
          <Field label="Short-circuit current (kA)" badge={prov("short_circuit_current_ka")}>
            <input className={`input ${need("short_circuit_current_ka")}`} type="number" step="0.1" value={f.short_circuit_current_ka} onChange={(e) => set("short_circuit_current_ka", e.target.value)} placeholder="Not provided" />
          </Field>
          <Field label="Max voltage drop (%)" badge={prov("max_voltage_drop_pct")}>
            <input className="input" type="number" step="0.5" value={f.max_voltage_drop_pct} onChange={(e) => set("max_voltage_drop_pct", e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
          {missingCritical.length > 0 && <span className="text-xs font-medium text-red-600">Required: {missingCritical.map((k) => FIELD_LABEL[k!]).join(", ")}</span>}
          {hasDesign && dirty && <button className="btn-ghost" onClick={() => setF(original)}>Discard</button>}
          {hasDesign ? (
            <button className="btn-primary" disabled={!dirty || !!busy || missingCritical.length > 0} onClick={() => run({ type: "update_inputs", patch })}>
              {busy === "update_inputs" ? "Recalculating…" : "Recalculate Design"}
            </button>
          ) : (
            <button className="btn-accent" disabled={!!busy || missingCritical.length > 0} onClick={() => onGenerate(patch)}>
              {busy === "design" ? "Running engineering engine…" : "Generate Engineering Design →"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, badge, children }: { label: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ results

export function ResultsCard({ project }: { project: Project }) {
  const calc = project.design!.calculation;
  const approved = project.status === "APPROVED";
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Engineering calculations" actions={<Badge t="blue">Deterministic engine — no LLM math</Badge>}>
      <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total connected current" value={`${calc.total_current_a} A`} />
        <Metric label="Main breaker" value={`${calc.main_breaker_a} A`} />
        <Metric label="Motor circuits" value={calc.motor_circuits.map((c) => `${c.quantity} × ${c.power_kw} kW @ ${c.full_load_current_a} A`).join(" · ")} />
        <Metric label="Enclosure IP" value={calc.required_ip_rating ?? "Requires environment"} />
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr><th>Result</th><th>Value</th><th>Reason / traceability</th><th>Standard reference</th><th>Status</th></tr>
          </thead>
          <tbody>
            {calc.results.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td className="font-medium">{r.label}<div className="mt-1"><ProvenanceBadge p={r.provenance} /></div></td>
                <td className="whitespace-nowrap font-mono text-[13px] font-semibold">{r.value}</td>
                <td className="text-xs text-slate-600">
                  {r.reason}
                  {r.formula && <div className="mt-1 font-mono text-[11px] text-slate-500">{r.formula}</div>}
                  {open === r.id && <div className="mt-1 text-[11px] text-slate-400">Rule: {r.rule_id}</div>}
                </td>
                <td className="text-xs">{r.standards.join(" / ")}</td>
                <td><ResultStatusBadge s={r.status} approved={approved && r.status !== "INSUFFICIENT_DATA"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

// ------------------------------------------------------------------ warnings

export function WarningsCard({ project, run, busy }: { project: Project; run: RunAction; busy: string | null }) {
  const ws = project.design!.calculation.warnings;
  const order = { critical: 0, warning: 1, info: 2 };
  const sorted = [...ws].sort((a, b) => order[a.severity] - order[b.severity]);
  const open = ws.filter((w) => !w.acknowledged).length;
  return (
    <Card title={`Warnings & unresolved issues (${open} open)`} actions={<span className="text-xs text-slate-500">Critical items must be acknowledged before approval</span>}>
      <ul className="divide-y divide-slate-100">
        {sorted.map((w) => (
          <li key={w.id} className={`flex items-start gap-3 px-5 py-2.5 text-sm ${w.acknowledged ? "opacity-60" : ""}`}>
            <span className="mt-0.5">{w.severity === "info" ? "ℹ" : "⚠"}</span>
            <div className="min-w-0 flex-1">
              <div className={w.acknowledged ? "line-through" : ""}>{w.message}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <SeverityBadge s={w.severity} />
                {w.standards?.map((s) => <Badge key={s} t="cyan">{s}</Badge>)}
                {w.acknowledged && <span className="text-[11px] text-slate-500">Acknowledged by {w.acknowledged_by}</span>}
              </div>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={!!w.acknowledged} disabled={!!busy} onChange={(e) => run({ type: "ack_warning", warning_id: w.id, acknowledged: e.target.checked })} />
              Acknowledge
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ BOM

const LINE_TYPES: Record<string, ProductType[]> = {
  protection: ["mpcb", "mcb", "mccb"],
  main_breaker: ["mccb", "mcb"],
  contactor: ["contactor"],
  overload: ["overload_relay", "mpcb"],
  cable: ["power_cable"],
  vfd: ["vfd"],
  softstarter: ["soft_starter"],
  enclosure: ["enclosure"],
};

function candidatesFor(line: BomLine, products: Product[]): Product[] {
  const key = line.id.includes(".") && !line.id.startsWith("custom") ? line.id.split(".").pop()! : line.id;
  const current = products.find((p) => p.sku === line.sku);
  const types = LINE_TYPES[key] ?? (current ? [current.attributes.product_type] : []);
  return types.length ? products.filter((p) => types.includes(p.attributes.product_type)) : products;
}

export function BomCard({ project, products, run, busy }: { project: Project; products: Product[]; run: RunAction; busy: string | null }) {
  const bom = project.design!.bom;
  const [addSku, setAddSku] = useState("");
  const [addQty, setAddQty] = useState("1");
  const counts = { IN_STOCK: 0, LOW_STOCK: 0, OUT_OF_STOCK: 0, UNAVAILABLE: 0 };
  bom.forEach((l) => counts[l.stock_status]++);
  return (
    <Card
      title={`Bill of Materials · Inventory check (${bom.length} lines)`}
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Badge t="emerald">✓ {counts.IN_STOCK} in stock</Badge>
          <Badge t="amber">⚠ {counts.LOW_STOCK} low</Badge>
          <Badge t="red">✕ {counts.OUT_OF_STOCK} out</Badge>
          <Badge t="red">✕ {counts.UNAVAILABLE} unavailable</Badge>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Component</th><th>Specification</th><th className="w-24">Qty</th><th className="w-28">Unit price</th><th className="text-right">Line total</th><th>Stock</th><th>Standard</th><th></th>
            </tr>
          </thead>
          <tbody>
            {bom.map((l) => (
              <BomRow key={`${l.id}-${l.sku}-${l.quantity}-${l.unit_price}`} line={l} products={products} run={run} busy={busy} />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8} className="bg-slate-50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Add component:</span>
                  <select className="input max-w-sm" value={addSku} onChange={(e) => setAddSku(e.target.value)}>
                    <option value="">— select catalog item —</option>
                    {products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} · {p.name}</option>)}
                  </select>
                  <input className="input w-20" type="number" min={1} value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                  <button className="btn-ghost" disabled={!addSku || !!busy} onClick={async () => { if (await run({ type: "add_line", sku: addSku, quantity: Number(addQty) })) setAddSku(""); }}>
                    Add
                  </button>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function BomRow({ line: l, products, run, busy }: { line: BomLine; products: Product[]; run: RunAction; busy: string | null }) {
  const [qty, setQty] = useState(String(l.quantity));
  const [price, setPrice] = useState(String(l.unit_price));
  const [replacing, setReplacing] = useState(false);
  const save = (o: Record<string, unknown>) => run({ type: "bom_override", line_id: l.id, override: o });
  const unavailable = l.stock_status === "UNAVAILABLE";
  return (
    <tr className={unavailable ? "bg-red-50/60" : ""}>
      <td className="min-w-64">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{l.category} · {l.function}</div>
        <div className="font-medium">{l.name}</div>
        <div className="text-[11px] text-slate-500">{l.sku ?? "—"} {l.manufacturer && `· ${l.manufacturer}`}</div>
        <div className="mt-1 text-[11px] text-slate-500" title={l.reasoning}>{l.reasoning}</div>
        {l.overridden && <div className="mt-1"><ProvenanceBadge p="ENGINEER_OVERRIDE" /></div>}
        {replacing && (
          <select
            className="input mt-2"
            defaultValue=""
            onChange={async (e) => { if (e.target.value && (await save({ sku: e.target.value }))) setReplacing(false); }}
          >
            <option value="">— replace with —</option>
            {candidatesFor(l, products).map((p) => <option key={p.sku} value={p.sku}>{p.sku} · {p.name} · {eur(p.selling_price_eur)} · stock {p.stock_quantity}</option>)}
          </select>
        )}
      </td>
      <td className="text-xs">
        <div className="font-mono">{l.specification}</div>
        <div className="mt-1 text-slate-500">Required: {l.required_spec}</div>
      </td>
      <td>
        <input className="input px-2" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => Number(qty) !== l.quantity && save({ quantity: Number(qty) })} />
        <div className="mt-0.5 text-[11px] text-slate-500">{l.unit}</div>
      </td>
      <td>
        <input className="input px-2" type="number" min={0} step="0.01" value={price} disabled={unavailable} onChange={(e) => setPrice(e.target.value)} onBlur={() => Number(price) !== l.unit_price && save({ unit_price: Number(price) })} />
      </td>
      <td className="text-right font-medium tabular-nums">{unavailable ? "—" : eur(l.quantity * l.unit_price)}</td>
      <td>
        <StockBadge s={l.stock_status} />
        {l.sku && <div className="mt-1 text-[11px] text-slate-500">avail. {l.stock} / req. {l.quantity}</div>}
      </td>
      <td className="text-xs">{l.standard_reference.join(" / ") || "—"}</td>
      <td className="whitespace-nowrap text-right text-xs">
        <button className="font-medium text-slate-700 hover:underline" disabled={!!busy} onClick={() => setReplacing(!replacing)}>{replacing ? "Cancel" : "Replace"}</button>
        <br />
        <button className="text-red-600 hover:underline" disabled={!!busy} onClick={() => save({ removed: true })}>Remove</button>
        {l.overridden && !l.id.startsWith("custom") && (
          <>
            <br />
            <button className="text-slate-500 hover:underline" disabled={!!busy} onClick={() => run({ type: "bom_override", line_id: l.id, override: null })}>Reset</button>
          </>
        )}
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------ cost

export function CostCard({ project, run, busy }: { project: Project; run: RunAction; busy: string | null }) {
  const c = project.design!.cost;
  const s = project.cost_settings;
  const [margin, setMargin] = useState(String(c.margin_pct));
  const [lh, setLh] = useState(String(s.labor_hours.value));
  const [eh, setEh] = useState(String(s.engineering_hours.value));
  const [lr, setLr] = useState(String(s.labor_rate_eur_h));
  const [er, setEr] = useState(String(s.engineering_rate_eur_h));
  const dirty = Number(margin) !== c.margin_pct || Number(lh) !== s.labor_hours.value || Number(eh) !== s.engineering_hours.value || Number(lr) !== s.labor_rate_eur_h || Number(er) !== s.engineering_rate_eur_h;
  return (
    <Card title="Cost calculation" className="h-full">
      <div className="p-5">
        <table className="w-full text-sm">
          <tbody className="[&_td]:py-1.5">
            <tr><td>Material cost <span className="text-xs text-slate-500">(selling price)</span></td><td className="text-right tabular-nums">{eur(c.material_cost)}</td></tr>
            <tr>
              <td>Labor <span className="text-xs text-slate-500">{c.labor_hours} h × {eur(s.labor_rate_eur_h)}/h</span> <ProvenanceBadge p={s.labor_hours.provenance} /></td>
              <td className="text-right tabular-nums">{eur(c.labor_cost)}</td>
            </tr>
            <tr>
              <td>Engineering <span className="text-xs text-slate-500">{c.engineering_hours} h × {eur(s.engineering_rate_eur_h)}/h</span> <ProvenanceBadge p={s.engineering_hours.provenance} /></td>
              <td className="text-right tabular-nums">{eur(c.engineering_cost)}</td>
            </tr>
            <tr className="border-t border-slate-200"><td>Subtotal</td><td className="text-right tabular-nums">{eur(c.subtotal)}</td></tr>
            <tr><td>Margin {c.margin_pct}%</td><td className="text-right tabular-nums">{eur(c.margin_amount)}</td></tr>
            <tr className="border-t-2 border-slate-900 text-base font-semibold"><td>Final quote (excl. VAT)</td><td className="text-right tabular-nums">{eur(c.total)}</td></tr>
          </tbody>
        </table>
        <div className="mt-2 text-xs text-slate-500">Internal material purchase cost: {eur(c.material_purchase_cost)}</div>
        {c.excluded_lines.length > 0 && (
          <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Not costed (unavailable or quantity 0): {c.excluded_lines.join("; ")}
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-5">
          <Field label="Margin %"><input className="input" type="number" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>
          <Field label="Labor h"><input className="input" type="number" value={lh} onChange={(e) => setLh(e.target.value)} /></Field>
          <Field label="€/h labor"><input className="input" type="number" value={lr} onChange={(e) => setLr(e.target.value)} /></Field>
          <Field label="Eng. h"><input className="input" type="number" value={eh} onChange={(e) => setEh(e.target.value)} /></Field>
          <Field label="€/h eng."><input className="input" type="number" value={er} onChange={(e) => setEr(e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            className="btn-primary"
            disabled={!dirty || !!busy}
            onClick={() =>
              run({
                type: "cost_settings",
                settings: {
                  margin_pct: Number(margin),
                  labor_rate_eur_h: Number(lr),
                  engineering_rate_eur_h: Number(er),
                  ...(Number(lh) !== s.labor_hours.value ? { labor_hours: Number(lh) } : {}),
                  ...(Number(eh) !== s.engineering_hours.value ? { engineering_hours: Number(eh) } : {}),
                },
              })
            }
          >
            {busy === "cost_settings" ? "Updating…" : "Update cost"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ CAD

export function CadCard({ project }: { project: Project }) {
  const d = project.design!;
  const [json, setJson] = useState(false);
  return (
    <Card
      title="CAD preview — single-line diagram"
      className="h-full"
      actions={
        d.cad && (
          <>
            <Badge t="slate">{d.cad.adapter}</Badge>
            <a className="btn-ghost py-1 text-xs" href={`/api/projects/${project.id}/dxf`}>Download DXF</a>
            <button className="btn-ghost py-1 text-xs" onClick={() => setJson(!json)}>{json ? "Diagram" : "CAD JSON"}</button>
          </>
        )
      }
    >
      <div className="p-4">
        {!d.cad ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">{d.cad_error ?? "CAD preview unavailable."}</div>
        ) : json ? (
          <pre className="max-h-[480px] overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{JSON.stringify(d.cad.contract, null, 2)}</pre>
        ) : (
          // SVG is produced by our own local generator from escaped text — not user HTML.
          <div className="overflow-auto rounded-lg border border-slate-200" dangerouslySetInnerHTML={{ __html: d.cad.svg }} />
        )}
        <p className="mt-2 text-[11px] text-slate-500">Preliminary drawing generated from the CAD data contract. AutoCAD/MCP integration can consume the same JSON.</p>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ standards

export function StandardsCard({ project, standards, rules }: { project: Project; standards: StandardDefinition[]; rules: StandardRule[] }) {
  const calc = project.design!.calculation;
  const ruleIds = new Set([...calc.results.map((r) => r.rule_id), ...calc.warnings.map((w) => w.rule_id).filter(Boolean)]);
  const codes = new Set([...calc.results.flatMap((r) => r.standards), ...project.design!.bom.flatMap((l) => l.standard_reference)]);
  const used = standards.filter((s) => codes.has(s.code));
  return (
    <Card title="Standards used" actions={<Badge t="cyan">{calc.inputs_snapshot.standard} rule set</Badge>}>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        <ul className="space-y-2">
          {used.map((s) => (
            <li key={s.code} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-sm font-semibold">{s.code} <span className="font-normal text-slate-600">— {s.title}</span></div>
              <div className="text-xs text-slate-500">Edition: {s.version === "configurable" ? "not configured (reference only)" : s.version}</div>
            </li>
          ))}
        </ul>
        <div>
          <div className="label">Rules applied</div>
          <ul className="space-y-1.5 text-xs">
            {rules.filter((r) => ruleIds.has(r.id)).map((r) => (
              <li key={r.id}><span className="font-medium">{r.name}</span> <span className="text-slate-500">({r.standard.join(" / ")})</span> — {r.implementation}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">Standards are referenced, not reproduced. VeatsAI does not certify compliance.</p>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ notes & history

export function NotesCard({ project, run, busy }: { project: Project; run: RunAction; busy: string | null }) {
  const [text, setText] = useState("");
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Engineering notes">
        <div className="space-y-3 p-5">
          {project.notes.length === 0 && <p className="text-sm text-slate-500">No notes yet.</p>}
          {project.notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>{n.text}</div>
              <div className="mt-1 text-[11px] text-slate-500">{n.author} · {fmtDate(n.created_at)}</div>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="input" placeholder="Add engineering note…" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn-ghost" disabled={!text.trim() || !!busy} onClick={async () => { if (await run({ type: "add_note", text })) setText(""); }}>Add</button>
          </div>
        </div>
      </Card>
      <Card title="Review history">
        <ul className="max-h-72 divide-y divide-slate-100 overflow-auto">
          {[...project.history].reverse().map((h) => (
            <li key={h.id} className="px-5 py-2 text-xs">
              <span className="font-semibold">{h.action.replace(/_/g, " ")}</span> · {h.author} · <span className="text-slate-500">{fmtDate(h.created_at)}</span>
              {h.detail && <div className="truncate text-slate-500">{h.detail}</div>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
