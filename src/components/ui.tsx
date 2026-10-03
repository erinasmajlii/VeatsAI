import type { ProjectStatus, Provenance, ResultStatus, StockStatus, WarningSeverity } from "@/lib/types";

const tone = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
} as const;
export type Tone = keyof typeof tone;

export function Badge({ children, t = "slate", title }: { children: React.ReactNode; t?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone[t]}`}>
      {children}
    </span>
  );
}

const STATUS: Record<ProjectStatus, [string, Tone]> = {
  DRAFT: ["Draft", "slate"],
  MISSING_INFORMATION: ["Missing information", "amber"],
  AI_PROCESSING: ["AI processing", "violet"],
  ENGINEERING_REVIEW: ["Engineering review", "blue"],
  NEEDS_CHANGES: ["Needs changes", "orange"],
  APPROVED: ["Approved by engineer", "emerald"],
};
export function StatusBadge({ s }: { s: ProjectStatus }) {
  const [label, t] = STATUS[s];
  return <Badge t={t}>{label}</Badge>;
}

const PROV: Record<Provenance, [string, Tone]> = {
  AI_GENERATED: ["AI generated", "violet"],
  ENGINEERING_CALCULATION: ["Engineering calculation", "blue"],
  STANDARDS_RULE: ["Standards-based rule", "cyan"],
  ASSUMED_VALUE: ["Assumed value", "amber"],
  USER_PROVIDED: ["User provided", "slate"],
  ENGINEER_OVERRIDE: ["Engineer override", "orange"],
  CATALOG: ["Catalog selection", "slate"],
};
export function ProvenanceBadge({ p }: { p: Provenance }) {
  const [label, t] = PROV[p];
  return <Badge t={t}>{label}</Badge>;
}

export function ResultStatusBadge({ s, approved }: { s: ResultStatus; approved?: boolean }) {
  if (approved) return <Badge t="emerald">Approved by engineer</Badge>;
  if (s === "INSUFFICIENT_DATA") return <Badge t="red">Insufficient data</Badge>;
  if (s === "OK") return <Badge t="emerald">OK</Badge>;
  return <Badge t="amber">Requires engineer review</Badge>;
}

const STOCK: Record<StockStatus, [string, Tone]> = {
  IN_STOCK: ["✓ In stock", "emerald"],
  LOW_STOCK: ["⚠ Low stock", "amber"],
  OUT_OF_STOCK: ["✕ Out of stock", "red"],
  UNAVAILABLE: ["✕ Component unavailable", "red"],
};
export function StockBadge({ s }: { s: StockStatus }) {
  const [label, t] = STOCK[s];
  return <Badge t={t}>{label}</Badge>;
}

const SEV: Record<WarningSeverity, [string, Tone]> = { critical: ["Critical", "red"], warning: ["Warning", "amber"], info: ["Info", "slate"] };
export function SeverityBadge({ s }: { s: WarningSeverity }) {
  const [label, t] = SEV[s];
  return <Badge t={t}>{label}</Badge>;
}

export const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
export const fmtDate = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="no-print flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 bg-white px-8 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", id }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`card ${className}`}>
      {title && (
        <div className="card-h">
          <h2 className="card-t">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

const LEGEND: [React.ReactNode, string][] = [
  [<ProvenanceBadge key="ai" p="AI_GENERATED" />, "interpreted from the request by the language model"],
  [<ProvenanceBadge key="calc" p="ENGINEERING_CALCULATION" />, "deterministic formula, no LLM math"],
  [<ProvenanceBadge key="std" p="STANDARDS_RULE" />, "selection from a referenced rule"],
  [<ProvenanceBadge key="assumed" p="ASSUMED_VALUE" />, "default used because data was missing"],
  [<Badge key="review" t="amber">Requires engineer review</Badge>, "must be verified before approval"],
  [<Badge key="approved" t="emerald">Approved by engineer</Badge>, "verified and signed off"],
];
export function ProvenanceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[11px] text-slate-500">
      <span className="font-semibold uppercase tracking-wide text-slate-600">Legend</span>
      {LEGEND.map(([badge, text], i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {badge}
          <span>{text}</span>
        </span>
      ))}
    </div>
  );
}

export function SafetyBanner() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-900">
      <strong>AI-assisted engineering · standards-referenced · preliminary calculation.</strong> Results are not a certification, do not guarantee
      compliance or safety, and are not ready for installation. Engineering review and approval by a responsible engineer is required.
    </div>
  );
}
