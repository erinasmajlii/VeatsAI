import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPANY } from "@/lib/config";
import { repo } from "@/lib/db";
import { STARTING_METHOD_LABEL } from "@/lib/engineering/constants";
import { eur, fmtDate } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { LOCALE } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { quoteNumber } from "@/lib/projects/service";
import { STANDARDS } from "@/lib/standards";
import type { ProjectStatus, StockStatus } from "@/lib/types";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

// The quote is a printed document: it always renders as white paper (also in dark mode),
// so it uses fixed light colours instead of the theme tokens.
const STOCK_CLS: Record<StockStatus, string> = {
  IN_STOCK: "text-emerald-700",
  LOW_STOCK: "text-amber-700",
  OUT_OF_STOCK: "text-red-700",
  UNAVAILABLE: "text-red-700",
};
const STATUS_CLS: Record<ProjectStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  RELEASED: "bg-slate-900 text-white",
  MISSING_INFORMATION: "bg-amber-50 text-amber-800",
  AI_PROCESSING: "bg-violet-50 text-violet-700",
  ENGINEERING_REVIEW: "bg-blue-50 text-blue-700",
  NEEDS_CHANGES: "bg-orange-50 text-orange-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
};

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, lang } = await getT();
  const p = await repo().getProject(id);
  if (!p) notFound();
  const d = p.design;
  if (!d) {
    return (
      <div className="p-8 text-sm">
        {t("qd.noDesign")} <Link className="underline" href={`/projects/${id}`}>{t("qd.back")}</Link>
      </div>
    );
  }
  const calc = d.calculation;
  const inputs = calc.inputs_snapshot;
  const codes = new Set([...calc.results.flatMap((r) => r.standards), ...d.bom.flatMap((l) => l.standard_reference)]);
  const approved = p.status === "APPROVED" || p.status === "RELEASED";
  const issued = [...p.history].reverse().find((h) => h.action === "QUOTE_GENERATED")?.created_at ?? p.updated_at;
  const validUntil = new Date(new Date(issued).getTime() + COMPANY.quote_validity_days * 864e5);
  const openWarnings = calc.warnings.filter((w) => w.severity !== "info");

  return (
    <div className="bg-muted py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-4xl items-center justify-between px-4">
        <Link href={`/projects/${id}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">{t("qd.back")}</Link>
        <PrintButton label={t("qd.print")} />
      </div>
      <article className="quote-doc print-full mx-auto max-w-4xl bg-white px-12 py-10 text-[13px] leading-relaxed text-slate-900 shadow-sm print:shadow-none" style={{ colorScheme: "light" }}>
        <div className="print-footer">
          <span>{quoteNumber(p)} · {COMPANY.name}</span>
          <span>{t("qd.footer")}</span>
        </div>
        {!approved && (
          <div className="mb-6 rounded border-2 border-amber-400 bg-amber-50 px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-amber-900">{t("qd.draftBanner")}</div>
        )}
        <header className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div>
            <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">{COMPANY.name}</div>
            <div className="text-xs text-slate-500">{COMPANY.address} · {COMPANY.email}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light uppercase tracking-widest text-slate-400">{t("qd.quotation")}</div>
            <div className="font-mono text-sm font-semibold">{quoteNumber(p)}</div>
            <div className="text-xs text-slate-500">{t("qd.date")} {fmtDate(issued, lang)}</div>
            <div className="text-xs text-slate-500">{t("qd.validUntil")} {validUntil.toLocaleDateString(LOCALE[lang])}</div>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{t("qd.client")}</div>
            <div className="text-base font-semibold">{p.client_name}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{t("qd.project")}</div>
            <div className="text-base font-semibold">{p.title}</div>
            <div className="text-xs text-slate-500">{t("qd.ref", { id: p.id, name: p.engineer })}</div>
          </div>
        </section>

        <Section title={t("qd.description")}>
          <p>{p.original_request}</p>
        </Section>

        <Section title={t("qd.summary")}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            <Row k={t("qd.supply")} v={`${inputs.voltage.value} V, ${inputs.phases.value}-${t("qd.phase")}, ${inputs.frequency.value} Hz`} />
            <Row k={t("qd.starting")} v={inputs.starting_method.value ? STARTING_METHOD_LABEL[inputs.starting_method.value] : "—"} />
            {calc.motor_circuits.map((c) => (
              <Row
                key={c.label}
                k={t("qd.motors", { label: c.label })}
                v={t("qd.motorLine", { q: c.quantity, kw: c.power_kw, flc: c.full_load_current_a, prot: c.branch_protection_a, csa: c.cable_csa_mm2 ?? "—" })}
              />
            ))}
            <Row k={t("qd.totalCurrent")} v={`${calc.total_current_a} A`} />
            <Row k={t("qd.mainBreaker")} v={`${calc.main_breaker_a} A, 3P`} />
            <Row k={t("qd.ip")} v={calc.required_ip_rating ?? t("qd.ipNeeds")} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t("qd.preliminary", { pf: inputs.power_factor.value, eff: inputs.efficiency.value })}</p>
        </Section>

        <Section title={t("qd.standards")}>
          <ul className="grid grid-cols-2 gap-x-8 text-xs">
            {STANDARDS.filter((s) => codes.has(s.code)).map((s) => (
              <li key={s.code}><strong>{s.code}</strong> — {s.title}</li>
            ))}
          </ul>
        </Section>

        <Section title={t("qd.bom")}>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="bom-table w-full text-xs">
              <thead className="border-b border-slate-300 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-1">#</th><th>{t("qd.col.component")}</th><th>{t("qd.col.spec")}</th><th className="text-right">{t("qd.col.qty")}</th>
                  <th className="pl-3 text-right">{t("qd.col.unit")}</th><th className="pl-3 text-right">{t("qd.col.total")}</th><th className="pl-3">{t("qd.col.availability")}</th>
                </tr>
              </thead>
              <tbody>
                {d.bom.map((l, i) => (
                  <tr key={l.id} className="border-b border-slate-100 align-top">
                    <td className="py-1 pr-2 text-slate-400">{i + 1}</td>
                    <td className="pr-2"><div className="font-medium">{l.name}</div><div className="text-[10px] text-slate-500">{l.sku ?? t("qd.toSource")}</div></td>
                    <td className="pr-2 text-slate-600">{l.stock_status === "UNAVAILABLE" ? l.required_spec : l.specification}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{l.quantity} {l.unit === "pcs" ? "" : l.unit}</td>
                    <td className="whitespace-nowrap pl-3 text-right tabular-nums">{l.stock_status === "UNAVAILABLE" ? "TBD" : eur(l.unit_price)}</td>
                    <td className="whitespace-nowrap pl-3 text-right tabular-nums">{l.stock_status === "UNAVAILABLE" ? "TBD" : eur(l.quantity * l.unit_price)}</td>
                    <td className={`whitespace-nowrap pl-3 text-[11px] font-medium ${STOCK_CLS[l.stock_status]}`}>{t(`stock.${l.stock_status}` as MessageKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t("qd.price")}>
          <table className="ml-auto w-80 text-sm">
            <tbody className="[&_td]:py-1">
              <tr><td>{t("qd.materials")}</td><td className="text-right tabular-nums">{eur(d.cost.material_cost)}</td></tr>
              <tr><td>{t("qd.labor", { h: d.cost.labor_hours })}</td><td className="text-right tabular-nums">{eur(d.cost.labor_cost)}</td></tr>
              <tr><td>{t("qd.engineering", { h: d.cost.engineering_hours })}</td><td className="text-right tabular-nums">{eur(d.cost.engineering_cost)}</td></tr>
              <tr><td>{t("qd.margin", { pct: d.cost.margin_pct })}</td><td className="text-right tabular-nums">{eur(d.cost.margin_amount)}</td></tr>
              <tr className="border-t-2 border-slate-900 text-base font-bold"><td>{t("qd.totalExVat")}</td><td className="text-right tabular-nums">{eur(d.cost.total)}</td></tr>
            </tbody>
          </table>
          {d.cost.excluded_lines.length > 0 && <p className="mt-2 text-xs text-amber-800">{t("qd.notIncluded", { list: d.cost.excluded_lines.join("; ") })}</p>}
        </Section>

        {d.cad && (
          <Section title={t("qd.diagram")}>
            <div className="rounded border border-slate-200" dangerouslySetInnerHTML={{ __html: d.cad.svg }} />
          </Section>
        )}

        <Section title={t("qd.notes")}>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {p.notes.map((n) => <li key={n.id}>{n.text} <span className="text-slate-400">— {n.author}</span></li>)}
            {openWarnings.map((w) => <li key={w.id} className="text-slate-600">{w.message}{w.acknowledged ? t("qd.reviewed") : ""}</li>)}
          </ul>
        </Section>

        <Section title={t("qd.approval")}>
          <div className="flex items-center gap-3">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[p.status]}`}>{t(`status.${p.status}` as MessageKey)}</span>
            {approved ? (
              <span>{t("qd.approvedBy", { name: p.approved_by ?? "", date: p.approved_at ? fmtDate(p.approved_at, lang) : "" })}</span>
            ) : (
              <span className="text-amber-800">{t("qd.draftText")}</span>
            )}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">{t("qd.disclaimer")}</p>
        </Section>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 print:mt-4">
      <h2 className="mb-2 border-b border-slate-200 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{title}</h2>
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
