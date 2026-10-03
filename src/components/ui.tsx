"use client";

import { useEffect, useRef } from "react";
import type { MessageKey } from "@/lib/i18n";
import type { ProjectStatus, Provenance, ResultStatus, StockStatus, WarningSeverity } from "@/lib/types";
import { useT } from "./i18n";

// Theme-aware tones built from the design tokens (light + dark).
const tone = {
  slate: "bg-muted text-muted-foreground ring-border",
  blue: "bg-accent-soft text-accent ring-accent/20",
  violet: "bg-accent-soft text-accent ring-accent/20",
  emerald: "bg-success-soft text-success ring-success/20",
  amber: "bg-warning-soft text-warning ring-warning/25",
  red: "bg-danger-soft text-danger ring-danger/20",
  cyan: "bg-accent-soft text-accent ring-accent/20",
  orange: "bg-warning-soft text-warning ring-warning/25",
  dark: "bg-primary text-primary-foreground ring-primary",
} as const;
export type Tone = keyof typeof tone;

export function Badge({ children, t = "slate", title }: { children: React.ReactNode; t?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone[t]}`}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<ProjectStatus, Tone> = {
  DRAFT: "slate",
  IN_PROGRESS: "blue",
  MISSING_INFORMATION: "amber",
  AI_PROCESSING: "blue",
  ENGINEERING_REVIEW: "amber",
  NEEDS_CHANGES: "orange",
  APPROVED: "emerald",
  RELEASED: "dark",
};
export function StatusBadge({ s }: { s: ProjectStatus }) {
  const t = useT();
  return <Badge t={STATUS_TONE[s]}>{t(`status.${s}` as MessageKey)}</Badge>;
}

const PROV_TONE: Record<Provenance, Tone> = {
  AI_GENERATED: "blue",
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

/** Page header: small uppercase eyebrow + title (+ subtitle and actions). */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="no-print border-b border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-5 py-6 sm:px-8">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
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

/** Inline error / notice box. */
export function Notice({ kind = "error", children, onClose }: { kind?: "error" | "warning" | "success" | "info"; children: React.ReactNode; onClose?: () => void }) {
  const t = useT();
  const cls = {
    error: "border-danger/30 bg-danger-soft text-danger",
    warning: "border-warning/30 bg-warning-soft text-warning",
    success: "border-success/30 bg-success-soft text-success",
    info: "border-border bg-muted text-foreground",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-4 rounded-md border px-4 py-3 text-sm ${cls}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" className="shrink-0 text-xs font-medium underline" onClick={onClose}>
          {t("common.dismiss")}
        </button>
      )}
    </div>
  );
}

/** Accessible modal dialog: Escape and backdrop close it, focus moves into it. */
export function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`card w-full ${wide ? "max-w-2xl" : "max-w-lg"} shadow-xl outline-none`}>
        {children}
      </div>
    </div>
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
    <div className="rounded-md border border-warning/25 bg-warning-soft px-4 py-2.5 text-xs leading-relaxed text-warning">
      <strong className="font-medium">{t("safety.title")}</strong> {t("safety.body")}
    </div>
  );
}
