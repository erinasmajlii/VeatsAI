"use client";

import type { MessageKey } from "@/lib/i18n";
import type { ProjectStatus, Provenance, ResultStatus, StockStatus, WarningSeverity } from "@/lib/types";
import { useT } from "./i18n";

// Subtle, theme-aware tones (work on light and dark backgrounds).
const tone = {
  slate: "bg-muted text-muted-foreground ring-border",
  blue: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  violet: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  emerald: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  amber: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300",
  red: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300",
  cyan: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  orange: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
} as const;
export type Tone = keyof typeof tone;

export function Badge({ children, t = "slate", title }: { children: React.ReactNode; t?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone[t]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  DRAFT: "slate",
  MISSING_INFORMATION: "amber",
  AI_PROCESSING: "violet",
  ENGINEERING_REVIEW: "blue",
  NEEDS_CHANGES: "orange",
  APPROVED: "emerald",
};
export function StatusBadge({ s }: { s: ProjectStatus }) {
  const t = useT();
  return <Badge t={STATUS_TONE[s]}>{t(`status.${s}` as MessageKey)}</Badge>;
}

const PROV_TONE: Record<Provenance, Tone> = {
  AI_GENERATED: "violet",
  ENGINEERING_CALCULATION: "blue",
  STANDARDS_RULE: "cyan",
  ASSUMED_VALUE: "amber",
  USER_PROVIDED: "slate",
  ENGINEER_OVERRIDE: "orange",
  CATALOG: "slate",
};
export function ProvenanceBadge({ p }: { p: Provenance }) {
  const t = useT();
  return <Badge t={PROV_TONE[p]}>{t(`prov.${p}` as MessageKey)}</Badge>;
}

export function ResultStatusBadge({ s, approved }: { s: ResultStatus; approved?: boolean }) {
  const t = useT();
  if (approved) return <Badge t="emerald">{t("result.approved")}</Badge>;
  if (s === "INSUFFICIENT_DATA") return <Badge t="red">{t("result.insufficient")}</Badge>;
  if (s === "OK") return <Badge t="emerald">{t("result.ok")}</Badge>;
  return <Badge t="amber">{t("result.review")}</Badge>;
}

const STOCK_TONE: Record<StockStatus, Tone> = { IN_STOCK: "emerald", LOW_STOCK: "amber", OUT_OF_STOCK: "red", UNAVAILABLE: "red" };
export function StockBadge({ s }: { s: StockStatus }) {
  const t = useT();
  return <Badge t={STOCK_TONE[s]}>{t(`stock.${s}` as MessageKey)}</Badge>;
}

const SEV_TONE: Record<WarningSeverity, Tone> = { critical: "red", warning: "amber", info: "slate" };
export function SeverityBadge({ s }: { s: WarningSeverity }) {
  const t = useT();
  return <Badge t={SEV_TONE[s]}>{t(`sev.${s}` as MessageKey)}</Badge>;
}

/** Page header in the design language: small uppercase eyebrow + title. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="no-print border-b border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-6 py-8">
        <div>
          {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
          <h1 className="text-2xl font-normal tracking-tight text-foreground">{title}</h1>
          {subtitle && <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = "", id }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`card ${className}`}>
      {title && (
        <div className="card-h">
          <h2 className="card-t">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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

export function ProvenanceLegend() {
  const t = useT();
  const items: [React.ReactNode, string][] = [
    [<ProvenanceBadge key="ai" p="AI_GENERATED" />, t("legend.ai")],
    [<ProvenanceBadge key="calc" p="ENGINEERING_CALCULATION" />, t("legend.calc")],
    [<ProvenanceBadge key="std" p="STANDARDS_RULE" />, t("legend.std")],
    [<ProvenanceBadge key="assumed" p="ASSUMED_VALUE" />, t("legend.assumed")],
    [<Badge key="review" t="amber">{t("result.review")}</Badge>, t("legend.review")],
    [<Badge key="approved" t="emerald">{t("result.approved")}</Badge>, t("legend.approved")],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border px-4 py-2.5 text-[11px] text-muted-foreground">
      <span className="eyebrow">{t("legend.title")}</span>
      {items.map(([badge, text], i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {badge}
          <span>{text}</span>
        </span>
      ))}
    </div>
  );
}

export function SafetyBanner() {
  const t = useT();
  return (
    <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
      <strong className="font-medium">{t("safety.title")}</strong> {t("safety.body")}
    </div>
  );
}

/** Bolt-in-square logo mark from the design. */
export function LogoMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="1.5" />
      <path d="M13 6l-5 7h4l-1 5 5-7h-4l1-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
