"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { eur, fmtDate } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type { StandardDefinition, StandardRule } from "@/lib/standards";
import type { Product, Project } from "@/lib/types";
import { useLang, useT } from "@/components/i18n";
import { Badge, ProvenanceLegend, SafetyBanner, Spinner, StatusBadge } from "@/components/ui";
import { AnalysisCard, BomCard, CadCard, CostCard, InputsCard, NotesCard, ResultsCard, StandardsCard, StockCard, WarningsCard } from "./sections";

export type RunAction = (action: Record<string, unknown>) => Promise<boolean>;

type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const STAGES: Stage[] = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Project workspace — the 8 generation stages of the design:
 * 01 NLP · 02 Data · 03 Engineering engine · 04 BOM · 05 Stock · 06 Cost · 07 CAD/MCP · 08 Quote & approval.
 */
export function Workspace({
  initial,
  products,
  standards,
  rules,
  onChange,
  embedded = false,
}: {
  initial: Project;
  products: Product[];
  standards: StandardDefinition[];
  rules: StandardRule[];
  onChange?: (p: Project) => void;
  embedded?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const [project, setProjectState] = useState(initial);
  const [stage, setStage] = useState<Stage>(initial.design ? 3 : 2);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function setProject(p: Project) {
    setProjectState(p);
    onChange?.(p);
  }

  async function call(url: string, body: unknown, label: string): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError([data.error, data.detail, ...(data.issues ?? [])].filter(Boolean).join(" — "));
        return false;
      }
      if (data.id && "original_request" in data) setProject(data as Project);
      return true;
    } catch {
      setError(t("common.requestFailed"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const run: RunAction = (action) => call(`/api/projects/${project.id}/review`, action, String(action.type));
  const generate = async (patch: Record<string, unknown>) => {
    const ok = await call(`/api/projects/${project.id}/design`, { patch }, "design");
    if (ok) {
      setToast(t("proj.toast.design"));
      setStage(3);
    }
    return ok;
  };
  async function approve() {
    if (await run({ type: "approve" })) setToast(t("proj.toast.approved"));
  }
  async function openQuote() {
    if (await call("/api/quotes/generate", { project_id: project.id }, "quote")) {
      window.open(`/projects/${project.id}/quote`, "_blank");
      const res = await fetch(`/api/projects/${project.id}`);
      if (res.ok) setProject(await res.json());
    }
  }

  const d = project.design;
  const openCritical = d?.calculation.warnings.filter((w) => w.severity === "critical" && !w.acknowledged).length ?? 0;
  const approved = project.status === "APPROVED";
  const stageDone = (s: Stage) => (s === 1 ? !!project.analysis : s === 2 ? !!d : s === 8 ? approved : !!d);

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="no-print border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow">
              {embedded ? t("proj.eyebrow") : <><Link href="/projects" className="hover:text-foreground">{t("nav.projects")}</Link> / {project.id}</>}
            </div>
            <h1 className="mt-1 truncate text-lg font-normal tracking-tight">{project.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <StatusBadge s={project.status} />
              <span>{t("common.client")}: <span className="text-foreground">{project.client_name}</span></span>
              <span>{t("common.engineer")}: {project.engineer}</span>
              <span>{fmtDate(project.created_at, lang)}</span>
              <span>{project.inputs?.standard ?? "IEC"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {busy && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5" /> {t("common.working")}</span>}
            {d && (
              <div className="mr-1 text-right">
                <div className="eyebrow">{t("proj.quoteTotal")}</div>
                <div className="font-mono text-base tabular-nums">{eur(d.cost.total)}</div>
              </div>
            )}
            {d && (
              <button className="btn-ghost py-1.5 text-xs" onClick={openQuote} disabled={!!busy}>
                {busy === "quote" ? t("proj.generatingQuote") : t("proj.generateQuote")}
              </button>
            )}
            {embedded && <Link href={`/projects/${project.id}`} className="btn-ghost py-1.5 text-xs">{t("proj.openFull")}</Link>}
          </div>
        </div>
      </div>

      {/* Stage tabs */}
      <nav className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-muted/60 px-6 py-2 backdrop-blur">
        <span className="eyebrow mr-3">{t("proj.generation")}</span>
        {STAGES.map((s) => {
          const disabled = s > 2 && !d;
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => setStage(s)}
              aria-current={stage === s ? "step" : undefined}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition ${
                stage === s ? "bg-foreground text-background" : disabled ? "cursor-not-allowed text-muted-foreground/50" : "text-muted-foreground hover:bg-background hover:text-foreground"
              }`}
            >
              <span className="font-mono text-[10px] opacity-70">{String(s).padStart(2, "0")}</span>
              {t(`stage.${s}` as MessageKey)}
              {stageDone(s) && stage !== s && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
            </button>
          );
        })}
      </nav>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div className="flex-1 space-y-5 p-6">
        {error && (
          <div className="flex items-start justify-between gap-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            <span>{error}</span>
            <button className="text-xs font-medium underline" onClick={() => setError(null)}>{t("common.dismiss")}</button>
          </div>
        )}

        {stage === 1 && <AnalysisCard project={project} />}
        {stage === 2 && (
          <>
            <InputsCard project={project} busy={busy} onGenerate={generate} run={run} />
            {!d && busy === "design" && <DesignLoading />}
            {!d && project.status === "MISSING_INFORMATION" && busy !== "design" && <p className="text-xs text-muted-foreground">{t("in.missingNote")}</p>}
          </>
        )}
        {stage > 2 && !d && <div className="card px-6 py-10 text-center text-sm text-muted-foreground">{t("proj.needsDesign")}</div>}
        {d && stage === 3 && (
          <>
            <ProvenanceLegend />
            <ResultsCard project={project} />
            <WarningsCard project={project} run={run} busy={busy} />
            <StandardsCard project={project} standards={standards} rules={rules} />
          </>
        )}
        {d && stage === 4 && <BomCard project={project} products={products} run={run} busy={busy} />}
        {d && stage === 5 && <StockCard project={project} />}
        {d && stage === 6 && <CostCard key={`${d.cost.total}-${JSON.stringify(project.cost_settings)}`} project={project} run={run} busy={busy} />}
        {d && stage === 7 && <CadCard project={project} />}
        {d && stage === 8 && (
          <>
            <section className="card p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="eyebrow">{t("quote.stageTitle")}</div>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("quote.stageLead")}</p>
                  {!approved && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("quote.draftNote")}</p>}
                </div>
                <div className="text-right">
                  <div className="eyebrow">{t("proj.quoteTotal")}</div>
                  <div className="font-mono text-2xl tabular-nums">{eur(d.cost.total)}</div>
                  <button className="btn-primary mt-2" onClick={openQuote} disabled={!!busy}>{busy === "quote" ? t("proj.generatingQuote") : t("appr.openQuote")}</button>
                </div>
              </div>
            </section>

            <section id="approval" className={`card overflow-hidden ${approved ? "border-emerald-500/40" : ""}`}>
              <div className={`px-5 py-4 ${approved ? "bg-emerald-500/5" : "bg-muted/50"}`}>
                <h2 className="text-sm font-medium">{t("appr.title")}</h2>
                {approved ? (
                  <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{t("appr.approvedText", { name: project.approved_by ?? "", date: project.approved_at ? fmtDate(project.approved_at, lang) : "" })}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("appr.pendingText")}
                    {openCritical > 0 && <span className="mt-1 block font-medium text-red-700 dark:text-red-300">{t("appr.criticalOpen", { n: openCritical })}</span>}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <button className="btn-accent px-5" disabled={!!busy || approved || openCritical > 0} onClick={approve}>
                  {busy === "approve" ? <><Spinner /> {t("appr.approving")}</> : approved ? t("appr.approved") : t("appr.approve")}
                </button>
                <RequestChanges run={run} busy={busy} disabled={project.status === "NEEDS_CHANGES"} />
                {approved ? <Badge t="emerald">{t("result.approved")}</Badge> : <Badge t="amber">{t("result.review")}</Badge>}
              </div>
            </section>
            <NotesCard project={project} run={run} busy={busy} />
          </>
        )}

        <SafetyBanner />
      </div>
    </div>
  );
}

function RequestChanges({ run, busy, disabled }: { run: RunAction; busy: string | null; disabled: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button className="btn-ghost" disabled={!!busy || disabled} onClick={() => setOpen(true)}>
        {t("appr.requestChanges")}
      </button>
    );
  return (
    <div className="flex flex-1 items-center gap-2">
      <input className="input" placeholder={t("appr.whatChange")} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-ghost" disabled={!!busy} onClick={async () => { if (await run({ type: "request_changes", reason })) setOpen(false); }}>
        {t("common.submit")}
      </button>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 5000);
    return () => clearTimeout(id);
  }, [message, onClose]);
  return (
    <div role="status" className="no-print fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm shadow-lg">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground text-[10px] font-bold text-background">✓</span>
      <span className="flex-1">{message}</span>
      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  );
}

function DesignLoading() {
  const t = useT();
  return (
    <div className="card px-6 py-6" aria-busy>
      <div className="flex items-center gap-3 text-sm">
        <Spinner className="h-5 w-5" /> {t("proj.designLoading")}
      </div>
      <ul className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        {([1, 2, 3, 4, 5, 6] as const).map((n, i) => (
          <li key={n} className="flex animate-pulse items-center gap-2 rounded bg-muted px-3 py-2" style={{ animationDelay: `${i * 0.15}s` }}>
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" /> {t(`pipeline.${n}` as MessageKey)}
          </li>
        ))}
      </ul>
    </div>
  );
}
