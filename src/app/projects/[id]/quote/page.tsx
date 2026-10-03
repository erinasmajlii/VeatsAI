import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPANY } from "@/lib/config";
import { repo } from "@/lib/db";
import { STARTING_METHOD_LABEL } from "@/lib/engineering/constants";
import { quoteNumber } from "@/lib/projects/service";
import { STANDARDS } from "@/lib/standards";
import { StatusBadge, StockBadge, eur, fmtDate } from "@/components/ui";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await repo().getProject(id);
  if (!p) notFound();
  const d = p.design;
  if (!d) {
    return (
      <div className="p-8 text-sm">
        Generate the engineering design before creating a quote. <Link className="underline" href={`/projects/${id}`}>Back to project</Link>
      </div>
    );
  }
  const calc = d.calculation;
  const inputs = calc.inputs_snapshot;
  const codes = new Set([...calc.results.flatMap((r) => r.standards), ...d.bom.flatMap((l) => l.standard_reference)]);
  const approved = p.status === "APPROVED";
  const issued = [...p.history].reverse().find((h) => h.action === "QUOTE_GENERATED")?.created_at ?? p.updated_at;
  const validUntil = new Date(new Date(issued).getTime() + COMPANY.quote_validity_days * 864e5).toISOString();
  const openWarnings = calc.warnings.filter((w) => w.severity !== "info");

  return (
    <div className="bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-4xl items-center justify-between px-4">
        <Link href={`/projects/${id}`} className="text-sm text-slate-600 hover:underline">← Back to project</Link>
        <PrintButton />
      </div>
      <article className="quote-doc print-full mx-auto max-w-4xl bg-white px-12 py-10 text-[13px] leading-relaxed shadow-sm print:shadow-none">
        <div className="print-footer">
          <span>{quoteNumber(p)} · {COMPANY.name}</span>
          <span>Preliminary, AI-assisted — requires engineer approval</span>
        </div>
        {!approved && (
          <div className="mb-6 rounded border-2 border-amber-400 bg-amber-50 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-amber-900">
            Draft — not yet approved by engineer
          </div>
        )}
        <header className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div>
            <div className="text-xl font-bold tracking-tight">{COMPANY.name}</div>
            <div className="text-xs text-slate-500">{COMPANY.address} · {COMPANY.email}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light uppercase tracking-widest text-slate-400">Quotation</div>
            <div className="font-mono text-sm font-semibold">{quoteNumber(p)}</div>
            <div className="text-xs text-slate-500">Date {fmtDate(issued)}</div>
            <div className="text-xs text-slate-500">Valid until {new Date(validUntil).toLocaleDateString("en-GB")}</div>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client</div>
            <div className="text-base font-semibold">{p.client_name}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Project</div>
            <div className="text-base font-semibold">{p.title}</div>
            <div className="text-xs text-slate-500">Ref. {p.id} · Engineer {p.engineer}</div>
          </div>
        </section>

        <Section title="Description">
          <p>{p.original_request}</p>
        </Section>

        <Section title="Engineering summary">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <Row k="Supply" v={`${inputs.voltage.value} V, ${inputs.phases.value}-phase, ${inputs.frequency.value} Hz`} />
            <Row k="Starting method" v={inputs.starting_method.value ? STARTING_METHOD_LABEL[inputs.starting_method.value] : "—"} />
            {calc.motor_circuits.map((c) => (
              <Row key={c.label} k={`Motors ${c.label}`} v={`${c.quantity} × ${c.power_kw} kW · FLC ${c.full_load_current_a} A · protection ${c.branch_protection_a} A · cable ${c.cable_csa_mm2 ?? "—"} mm²`} />
            ))}
            <Row k="Total connected current" v={`${calc.total_current_a} A`} />
            <Row k="Main incoming breaker" v={`${calc.main_breaker_a} A, 3P`} />
            <Row k="Enclosure IP" v={calc.required_ip_rating ?? "Requires environmental specification"} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Preliminary, standards-referenced calculation (PF {inputs.power_factor.value}, η {inputs.efficiency.value}). Final values subject to engineering verification.</p>
        </Section>

        <Section title="Standards referenced">
          <ul className="grid grid-cols-2 gap-x-8 text-xs">
            {STANDARDS.filter((s) => codes.has(s.code)).map((s) => (
              <li key={s.code}><strong>{s.code}</strong> — {s.title}</li>
            ))}
          </ul>
        </Section>

        <Section title="Bill of materials">
          <div className="overflow-x-auto print:overflow-visible">
          <table className="bom-table w-full text-xs">
            <thead className="border-b border-slate-300 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="py-1">#</th><th>Component</th><th>Specification</th><th className="text-right">Qty</th><th className="pl-3 text-right">Unit</th><th className="pl-3 text-right">Total</th><th className="pl-3">Availability</th></tr>
            </thead>
            <tbody>
              {d.bom.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-100 align-top">
                  <td className="py-1 pr-2 text-slate-400">{i + 1}</td>
                  <td className="pr-2"><div className="font-medium">{l.name}</div><div className="text-[10px] text-slate-500">{l.sku ?? "to be sourced"}</div></td>
                  <td className="pr-2 text-slate-600">{l.stock_status === "UNAVAILABLE" ? l.required_spec : l.specification}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{l.quantity} {l.unit === "pcs" ? "" : l.unit}</td>
                  <td className="whitespace-nowrap pl-3 text-right tabular-nums">{l.stock_status === "UNAVAILABLE" ? "TBD" : eur(l.unit_price)}</td>
                  <td className="whitespace-nowrap pl-3 text-right tabular-nums">{l.stock_status === "UNAVAILABLE" ? "TBD" : eur(l.quantity * l.unit_price)}</td>
                  <td className="pl-3"><StockBadge s={l.stock_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>

        <Section title="Price">
          <table className="ml-auto w-80 text-sm">
            <tbody className="[&_td]:py-1">
              <tr><td>Materials</td><td className="text-right tabular-nums">{eur(d.cost.material_cost)}</td></tr>
              <tr><td>Labor ({d.cost.labor_hours} h)</td><td className="text-right tabular-nums">{eur(d.cost.labor_cost)}</td></tr>
              <tr><td>Engineering ({d.cost.engineering_hours} h)</td><td className="text-right tabular-nums">{eur(d.cost.engineering_cost)}</td></tr>
              <tr><td>Margin ({d.cost.margin_pct}%)</td><td className="text-right tabular-nums">{eur(d.cost.margin_amount)}</td></tr>
              <tr className="border-t-2 border-slate-900 text-base font-bold"><td>Total (excl. VAT)</td><td className="text-right tabular-nums">{eur(d.cost.total)}</td></tr>
            </tbody>
          </table>
          {d.cost.excluded_lines.length > 0 && <p className="mt-2 text-xs text-amber-800">Not included in price (to be quoted separately): {d.cost.excluded_lines.join("; ")}.</p>}
        </Section>

        {d.cad && (
          <Section title="Preliminary single-line diagram">
            <div className="rounded border border-slate-200" dangerouslySetInnerHTML={{ __html: d.cad.svg }} />
          </Section>
        )}

        <Section title="Engineering notes & open items">
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {p.notes.map((n) => <li key={n.id}>{n.text} <span className="text-slate-400">— {n.author}</span></li>)}
            {openWarnings.map((w) => <li key={w.id} className="text-slate-600">{w.message}{w.acknowledged ? " (reviewed by engineer)" : ""}</li>)}
          </ul>
        </Section>

        <Section title="Approval status">
          <div className="flex items-center gap-3">
            <StatusBadge s={p.status} />
            {approved ? (
              <span>Approved by <strong>{p.approved_by}</strong> on {p.approved_at ? fmtDate(p.approved_at) : ""}.</span>
            ) : (
              <span className="text-amber-800">Engineering review required — this quotation is a draft.</span>
            )}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            This quotation is based on an AI-assisted, standards-referenced preliminary design. It is not a certificate of compliance. Final design,
            device selection and installation are subject to verification by the responsible engineer.
          </p>
        </Section>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 print:mt-4">
      <h2 className="mb-2 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dotted border-slate-200 py-0.5 text-xs">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
