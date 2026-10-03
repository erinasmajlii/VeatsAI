"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StandardDefinition, StandardRule } from "@/lib/standards";
import type { Product, Project } from "@/lib/types";
import { Badge, ProvenanceLegend, SafetyBanner, Spinner, StatusBadge, eur, fmtDate } from "@/components/ui";
import { AnalysisCard, BomCard, CadCard, CostCard, InputsCard, NotesCard, ResultsCard, StandardsCard, WarningsCard } from "./sections";

export type RunAction = (action: Record<string, unknown>) => Promise<boolean>;

export function Workspace({ initial, products, standards, rules }: { initial: Project; products: Product[]; standards: StandardDefinition[]; rules: StandardRule[] }) {
  const [project, setProject] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
      setError("Request failed. Please retry.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const run: RunAction = (action) => call(`/api/projects/${project.id}/review`, action, String(action.type));
  const generate = async (patch: Record<string, unknown>) => {
    const ok = await call(`/api/projects/${project.id}/design`, { patch }, "design");
    if (ok) setToast("Engineering design generated — review calculations, warnings and BOM below.");
    return ok;
  };
  async function approve() {
    if (await run({ type: "approve" })) setToast("Project approved by engineer. The quote can now be issued to the client.");
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

  return (
    <div>
      {/* Header */}
      <div className="no-print border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">
              <Link href="/projects" className="hover:underline">Projects</Link> / {project.id}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{project.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <StatusBadge s={project.status} />
              <span>Client: <strong className="font-medium text-slate-900">{project.client_name}</strong></span>
              <span>Type: {project.analysis?.project_type.replace(/_/g, " ") ?? "—"}</span>
              <span>Engineer: {project.engineer}</span>
              <span>Created {fmtDate(project.created_at)}</span>
              <span>Standard: {project.inputs?.standard ?? "IEC"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {busy && <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-slate-500"><Spinner className="h-3.5 w-3.5" /> Working…</span>}
            {d && <span className="mr-2 text-right text-xs text-slate-500">Quote total<div className="text-lg font-semibold tabular-nums text-slate-900">{eur(d.cost.total)}</div></span>}
            {d && (
              <button className="btn-ghost" onClick={openQuote} disabled={!!busy}>
                {busy === "quote" ? "Generating…" : "Generate Quote"}
              </button>
            )}
            {d && <a href="#approval" className="btn-primary">Review & Approve</a>}
          </div>
        </div>
        <Stepper project={project} />
      </div>

      <SectionNav hasDesign={!!d} />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div className="space-y-6 p-8">
        <SafetyBanner />
        <ProvenanceLegend />
        {error && (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{error}</span>
            <button className="text-xs font-medium underline" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div id="ai" className="grid scroll-mt-16 gap-6 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <AnalysisCard project={project} />
          </div>
          <div className="xl:col-span-3">
            <InputsCard project={project} busy={busy} onGenerate={generate} run={run} />
          </div>
        </div>

        {!d && busy === "design" ? (
          <DesignLoading />
        ) : !d ? (
          <div className="card px-6 py-10 text-center text-sm text-slate-500">
            {project.status === "MISSING_INFORMATION"
              ? "Critical information is missing. Complete the highlighted fields above, then click “Generate Engineering Design”."
              : "Review the interpreted inputs above, then click “Generate Engineering Design”."}
          </div>
        ) : (
          <>
            <div id="engineering" className="scroll-mt-16"><ResultsCard project={project} /></div>
            <div id="warnings" className="scroll-mt-16"><WarningsCard project={project} run={run} busy={busy} /></div>
            <div id="bom" className="scroll-mt-16"><BomCard project={project} products={products} run={run} busy={busy} /></div>
            <div className="grid gap-6 xl:grid-cols-5">
              <div id="cost" className="scroll-mt-16 xl:col-span-2">
                <CostCard key={`${d.cost.total}-${JSON.stringify(project.cost_settings)}`} project={project} run={run} busy={busy} />
              </div>
              <div id="cad" className="scroll-mt-16 xl:col-span-3">
                <CadCard project={project} />
              </div>
            </div>
            <StandardsCard project={project} standards={standards} rules={rules} />
            <NotesCard project={project} run={run} busy={busy} />

            {/* Approval */}
            <section id="approval" className={`card scroll-mt-16 overflow-hidden ${approved ? "border-emerald-300" : ""}`}>
              <div className={`px-6 py-5 ${approved ? "bg-emerald-50" : "bg-slate-50"}`}>
                <h2 className="text-base font-semibold">Engineer approval</h2>
                {approved ? (
                  <p className="mt-1 text-sm text-emerald-800">
                    ✓ Approved by engineer <strong>{project.approved_by}</strong> on {project.approved_at ? fmtDate(project.approved_at) : ""}. Any further edit revokes approval.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-600">
                    AI is not the final authority. The responsible engineer verifies calculations, components and warnings before approval.
                    {openCritical > 0 && (
                      <span className="mt-1 block font-medium text-red-700">
                        {openCritical} critical warning(s) must be acknowledged before approval.
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 px-6 py-4">
                <button className="btn-accent px-5" disabled={!!busy || approved || openCritical > 0} onClick={approve}>
                  {busy === "approve" ? <><Spinner /> Approving…</> : approved ? "✓ Project Approved" : "APPROVE PROJECT"}
                </button>
                <RequestChanges run={run} busy={busy} disabled={project.status === "NEEDS_CHANGES"} />
                <button className="btn-ghost" onClick={openQuote} disabled={!!busy}>Open Quote</button>
                <span className="text-xs text-slate-500">
                  {approved ? <Badge t="emerald">Approved by engineer</Badge> : <Badge t="amber">Requires engineer review</Badge>}
                </span>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function RequestChanges({ run, busy, disabled }: { run: RunAction; busy: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button className="btn-ghost" disabled={!!busy || disabled} onClick={() => setOpen(true)}>
        Request Changes
      </button>
    );
  return (
    <div className="flex flex-1 items-center gap-2">
      <input className="input" placeholder="What needs to change?" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="btn-ghost"
        disabled={!!busy}
        onClick={async () => {
          if (await run({ type: "request_changes", reason })) setOpen(false);
        }}
      >
        Submit
      </button>
    </div>
  );
}

function Stepper({ project }: { project: Project }) {
  const d = !!project.design;
  const steps: [string, boolean][] = [
    ["Request", true],
    ["AI analysis", !!project.analysis],
    ["Missing info", project.status !== "MISSING_INFORMATION"],
    ["Engineering", d],
    ["Standards", d],
    ["BOM", d],
    ["Inventory", d],
    ["Cost", d],
    ["CAD", !!project.design?.cad],
    ["Quote", d],
    ["Review", project.status === "APPROVED"],
    ["Approved", project.status === "APPROVED"],
  ];
  const current = steps.findIndex(([, done]) => !done);
  return (
    <ol className="mt-5 flex flex-wrap gap-1.5 text-[11px] font-medium">
      {steps.map(([label, done], i) => (
        <li
          key={label}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${done ? "bg-emerald-50 text-emerald-700" : i === current ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}
        >
          {done ? "✓" : i + 1} {label}
        </li>
      ))}
    </ol>
  );
}

const SECTIONS: [id: string, label: string, needsDesign: boolean][] = [
  ["ai", "AI", false],
  ["engineering", "Engineering", true],
  ["warnings", "Warnings", true],
  ["bom", "BOM", true],
  ["cost", "Cost", true],
  ["cad", "CAD", true],
  ["approval", "Approval", true],
];

function SectionNav({ hasDesign }: { hasDesign: boolean }) {
  const [active, setActive] = useState("ai");
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-56px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [hasDesign]);
  return (
    <nav className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-8 backdrop-blur">
      <ul className="flex gap-1 overflow-x-auto py-2 text-sm">
        {SECTIONS.map(([id, label, needsDesign]) => {
          const disabled = needsDesign && !hasDesign;
          return (
            <li key={id}>
              <a
                href={disabled ? undefined : `#${id}`}
                aria-disabled={disabled}
                className={`block whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition ${
                  disabled ? "cursor-not-allowed text-slate-300" : active === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div role="status" className="no-print fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm shadow-lg ring-1 ring-emerald-100">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white">✓</span>
      <span className="flex-1 text-slate-700">{message}</span>
      <button className="text-xs text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  );
}

const PIPELINE = ["Engineering calculations", "Standards rules", "BOM selection", "Inventory check", "Cost calculation", "CAD drawing"];

function DesignLoading() {
  return (
    <div className="card px-6 py-8" aria-busy>
      <div className="flex items-center gap-3 text-sm font-medium text-slate-800">
        <Spinner className="h-5 w-5 text-emerald-600" /> Running the engineering engine…
      </div>
      <ul className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
        {PIPELINE.map((step, i) => (
          <li key={step} className="flex animate-pulse items-center gap-2 rounded-md bg-slate-50 px-3 py-2" style={{ animationDelay: `${i * 0.15}s` }}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {step}
          </li>
        ))}
      </ul>
    </div>
  );
}
