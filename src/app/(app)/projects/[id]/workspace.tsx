"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/components/api-error";
import { useT } from "@/components/i18n";
import { Badge, Notice, ProvenanceLegend, SafetyBanner, Spinner, StatusBadge } from "@/components/ui";
import { useUser } from "@/components/user-context";
import { LocalTime } from "@/components/local-time";
import { eur } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type { StandardDefinition, StandardRule } from "@/lib/standards";
import type { InventoryMovement, Product, Project, ProjectApproval } from "@/lib/types";
import { ApprovalPanel, Lifecycle } from "./approval-panel";
import { PlanWorkspace } from "./plan-workspace";
import { AnalysisCard, BomCard, CadCard, CostCard, InputsCard, NotesCard, ResultsCard, StandardsCard, StockCard, WarningsCard } from "./sections";

export type RunAction = (action: Record<string, unknown>) => Promise<boolean>;

export type Tab = "plan" | "request" | "data" | "engineering" | "bom" | "stock" | "cost" | "cad" | "quote" | "notes";
const TAB_LABEL: Record<Tab, MessageKey> = {
  plan: "plan.tab", request: "stage.1", data: "stage.2", engineering: "stage.3", bom: "stage.4", stock: "stage.5", cost: "stage.6", cad: "stage.7", quote: "stage.8", notes: "notes.title",
};

/**
 * Project details. A project can hold a written request (analysis → engineering design → BOM → quote),
 * an uploaded AutoCAD plan (analysis → electrical plan → CAD file), or both. Approval and release apply to all.
 */
export function Workspace({
  initial, products, standards, rules, approvals: initialApprovals, movements: initialMovements, initialTab,
}: {
  initial: Project;
  products: Product[];
  standards: StandardDefinition[];
  rules: StandardRule[];
  approvals: ProjectApproval[];
  movements: InventoryMovement[];
  initialTab?: string;
}) {
  const t = useT();
  const [project, setProject] = useState(initial);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [movements, setMovements] = useState(initialMovements);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const d = project.design;
  const hasPlan = !!project.plan;
  const tabs: Tab[] = [
    ...(hasPlan ? (["plan"] as Tab[]) : []),
    ...(project.analysis ? (["request"] as Tab[]) : []),
    ...(project.inputs ? (["data"] as Tab[]) : []),
    ...(d ? (["engineering", "bom", "stock", "cost", "cad", "quote"] as Tab[]) : []),
    "notes",
  ];
  const defaultTab: Tab = hasPlan && !project.inputs ? "plan" : d ? "engineering" : project.inputs ? "data" : "notes";
  const [tab, setTab] = useState<Tab>((tabs as string[]).includes(initialTab ?? "") ? (initialTab as Tab) : defaultTab);
  const current: Tab = tabs.includes(tab) ? tab : defaultTab;

  async function call(url: string, body: unknown, label: string): Promise<boolean> {
    setBusy(label);
    setError(null);
    const r = await api<Project>(url, { json: body });
    setBusy(null);
    if (!r.ok) {
      setError(errorMessage(t, r.data));
      return false;
    }
    if (r.data.id && "original_request" in r.data) setProject(r.data as Project);
    return true;
  }

  const run: RunAction = (action) => call(`/api/projects/${project.id}/review`, action, String(action.type));
  const generate = async (patch: Record<string, unknown>) => {
    const ok = await call(`/api/projects/${project.id}/design`, { patch }, "design");
    if (ok) {
      setToast(t("proj.toast.design"));
      setTab("engineering");
    }
    return ok;
  };
  async function openQuote() {
    if (await call("/api/quotes/generate", { project_id: project.id }, "quote")) {
      window.open(`/projects/${project.id}/quote`, "_blank");
      const res = await api<Project>(`/api/projects/${project.id}`);
      if (res.ok) setProject(res.data as Project);
    }
  }

  const openCritical = d?.calculation.warnings.filter((w) => w.severity === "critical" && !w.acknowledged).length ?? 0;
  const approved = project.status === "APPROVED" || project.status === "RELEASED";
  const ready = !!d || !!project.plan?.electrical;
  const done = (x: Tab) => (x === "plan" ? !!project.plan?.electrical : x === "quote" ? approved : x === "request" ? !!project.analysis : !!d && x !== "data" && x !== "notes");

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col">
      {/* Header */}
      <div className="no-print px-5 pb-4 pt-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow">
              <Link href="/projects" className="hover:text-foreground">{t("proj.breadcrumb")}</Link> / <span className="font-mono normal-case tracking-normal">{project.id}</span>
            </div>
            <h1 className="mt-1.5 truncate text-xl font-semibold tracking-tight">{project.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <StatusBadge s={project.status} />
              <span>{t("common.client")}: <span className="text-foreground">{project.client_name}</span></span>
              <span>{t("common.engineer")}: {project.approved_by ?? (project.engineer === "Unassigned" ? "—" : project.engineer)}</span>
              <span><LocalTime iso={project.created_at} /></span>
              <span>{project.inputs?.standard ?? "IEC"}</span>
              {hasPlan && <Badge t="blue">{t("page.projects.plan")}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {busy && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5" /> {t("common.working")}</span>}
            {d && (
              <div className="text-right">
                <div className="eyebrow">{t("proj.quoteTotal")}</div>
                <div className="font-mono text-base tabular-nums">{eur(d.cost.total)}</div>
              </div>
            )}
            {d && (
              <button className="btn-ghost py-1.5 text-xs" onClick={openQuote} disabled={!!busy}>
                {busy === "quote" ? t("proj.generatingQuote") : t("proj.generateQuote")}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <Lifecycle status={project.status} />
          <ApprovalPanel
            project={project}
            approvals={approvals}
            movements={movements}
            ready={ready}
            openCritical={openCritical}
            onProject={setProject}
            onApprovals={setApprovals}
            onMovements={setMovements}
            onToast={setToast}
            extraActions={d && project.status !== "RELEASED" ? <RequestChanges run={run} busy={busy} disabled={project.status === "NEEDS_CHANGES"} /> : undefined}
          />
        </div>
      </div>

      {/* Tabs */}
      <nav role="tablist" aria-label={project.title} className="no-print sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-y border-border bg-background/90 px-5 py-2 backdrop-blur sm:px-8">
        {tabs.map((x) => (
          <button
            key={x}
            role="tab"
            type="button"
            aria-selected={current === x}
            onClick={() => setTab(x)}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${current === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {t(TAB_LABEL[x])}
            {done(x) && current !== x && <span className="text-success" aria-hidden>✓</span>}
          </button>
        ))}
      </nav>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div className="flex-1 space-y-5 px-5 py-6 sm:px-8" role="tabpanel">
        {error && <Notice kind="error" onClose={() => setError(null)}>{error}</Notice>}

        {current === "plan" && <PlanWorkspace project={project} products={products} onProject={setProject} />}
        {current === "request" && <AnalysisCard project={project} />}
        {current === "data" && project.inputs && (
          <>
            <InputsCard project={project} busy={busy} onGenerate={generate} run={run} />
            {!d && busy === "design" && <DesignLoading />}
            {!d && project.status === "MISSING_INFORMATION" && busy !== "design" && <p className="text-xs text-muted-foreground">{t("in.missingNote")}</p>}
          </>
        )}
        {d && current === "engineering" && (
          <>
            <ProvenanceLegend />
            <ResultsCard project={project} />
            <WarningsCard project={project} run={run} busy={busy} />
            <StandardsCard project={project} standards={standards} rules={rules} />
          </>
        )}
        {d && current === "bom" && <BomCard project={project} products={products} run={run} busy={busy} />}
        {d && current === "stock" && <StockCard project={project} />}
        {d && current === "cost" && <CostCard key={`${d.cost.total}-${JSON.stringify(project.cost_settings)}`} project={project} run={run} busy={busy} />}
        {d && current === "cad" && <CadCard project={project} />}
        {d && current === "quote" && (
          <section className="card p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="eyebrow">{t("quote.stageTitle")}</div>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("quote.stageLead")}</p>
                {!approved && <p className="mt-1 text-xs text-warning">{t("quote.draftNote")}</p>}
              </div>
              <div className="text-right">
                <div className="eyebrow">{t("proj.quoteTotal")}</div>
                <div className="font-mono text-2xl tabular-nums">{eur(d.cost.total)}</div>
                <button className="btn-primary mt-2" onClick={openQuote} disabled={!!busy}>{busy === "quote" ? t("proj.generatingQuote") : t("quote.open")}</button>
              </div>
            </div>
          </section>
        )}
        {current === "notes" && <NotesCard project={project} run={run} busy={busy} />}

        <SafetyBanner />
      </div>
    </div>
  );
}

function RequestChanges({ run, busy, disabled }: { run: RunAction; busy: string | null; disabled: boolean }) {
  const t = useT();
  const isEngineer = useUser().role === "engineer";
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!isEngineer) return null;
  if (!open)
    return (
      <button className="btn-ghost" disabled={!!busy || disabled} onClick={() => setOpen(true)}>
        {t("appr.requestChanges")}
      </button>
    );
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <input className="input min-w-0 sm:w-64" placeholder={t("appr.whatChange")} value={reason} onChange={(e) => setReason(e.target.value)} />
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
    <div role="status" className="no-print fixed bottom-6 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-[10px] font-bold text-primary-foreground">✓</span>
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
