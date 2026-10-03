"use client";

import { useRef, useState } from "react";
import { api, errorMessage } from "@/components/api-error";
import { Icon } from "@/components/icons";
import { useT } from "@/components/i18n";
import { Badge, Card, Notice, Spinner } from "@/components/ui";
import { useUser } from "@/components/user-context";
import { LocalTime, useLocalDate } from "@/components/local-time";
import type { MessageKey } from "@/lib/i18n";
import type { ElectricalPlan, PlanAnalysis } from "@/lib/plan/types";
import type { Product, Project } from "@/lib/types";
import { DEFAULT_LAYERS, LegendSymbol, PlanView, type PlanLayers, type ViewMode } from "./plan-view";

const MAX_BYTES = 30 * 1024 * 1024;
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Step({ n, label, state }: { n: number; label: string; state: "done" | "current" | "todo" }) {
  return (
    <li className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${state === "done" ? "bg-success-soft text-success" : state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
      {state === "done" ? <Icon name="check" className="h-3.5 w-3.5" /> : <span className="font-mono text-[10px] opacity-70">{n}</span>}
      {label}
    </li>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-mono text-lg tabular-nums">{value}</div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

/**
 * The plan workflow of a project:
 * Upload plan → Analyse → Electrical plan → Review → CAD file → Open in AutoCAD.
 */
export function PlanWorkspace({ project, products, onProject }: { project: Project; products: Product[]; onProject: (p: Project) => void }) {
  const t = useT();
  const user = useUser();
  const plan = project.plan ?? null;
  const reviewedDate = useLocalDate(project.plan?.reviewed_at);
  const analysis: PlanAnalysis | null = plan?.analysis ?? null;
  const electrical: ElectricalPlan | null = plan?.electrical ?? null;
  const cad = plan?.cad ?? null;
  const locked = project.status === "RELEASED";
  const isEngineer = user.role === "engineer";

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(electrical ? "electrical" : "architecture");
  const [layers, setLayers] = useState<PlanLayers>(DEFAULT_LAYERS);
  const [cfg, setCfg] = useState({ lighting: true, switches: true, sockets: true, special_sockets: true, points: true, supply: "auto" as "auto" | "single_phase" | "three_phase", luminaire_w: 18 });
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(label: string, url: string, init: Parameters<typeof api>[1], onOk?: (p: Project) => void) {
    if (busy) return;
    setBusy(label);
    setError(null);
    setInfo(null);
    const r = await api<Project>(url, init);
    setBusy(null);
    if (!r.ok) return setError(errorMessage(t, r.data));
    onProject(r.data as Project);
    onOk?.(r.data as Project);
  }

  function upload(f: File | undefined | null) {
    if (!f) return;
    if (!/\.(dwg|dxf)$/i.test(f.name)) return setError(t("req.badType"));
    if (f.size > MAX_BYTES) return setError(t("req.tooBig"));
    const fd = new FormData();
    fd.set("file", f);
    run("upload", `/api/projects/${project.id}/plan`, { method: "POST", body: fd });
    if (fileRef.current) fileRef.current.value = "";
  }

  const generate = () => run("electrical", `/api/projects/${project.id}/plan/electrical`, { json: cfg }, () => setMode("electrical"));
  const review = () => run("review", `/api/projects/${project.id}/plan/review`, { method: "POST" });
  const makeCad = () => run("cad", `/api/projects/${project.id}/plan/cad`, { method: "POST" });
  const openCad = () =>
    run("open", `/api/projects/${project.id}/plan/open`, { method: "POST" }, (p) => setInfo(p.plan?.cad?.open_method === "autocad-mcp" ? t("plan.cad.opened") : t("plan.cad.openedOs")));

  const stepState = (done: boolean, current: boolean) => (done ? "done" : current ? "current" : "todo");
  const reviewed = !!plan?.reviewed_at;
  const steps = [
    { label: t("plan.step.upload"), state: stepState(!!plan, !plan) },
    { label: t("plan.step.analyse"), state: stepState(!!analysis, !!plan && !analysis) },
    { label: t("plan.step.electrical"), state: stepState(!!electrical, !!analysis && !electrical) },
    { label: t("plan.step.review"), state: stepState(reviewed, !!electrical && !reviewed) },
    { label: t("plan.step.cad"), state: stepState(!!cad, reviewed && !cad) },
    { label: t("plan.step.open"), state: stepState(!!cad?.opened_at, !!cad && !cad.opened_at) },
  ] as const;

  const stock = new Map(products.map((p) => [p.sku, p]));
  const roomName = (id: string | null) => (id ? analysis?.rooms.find((r) => r.id === id)?.name ?? id : t("plan.outside"));
  const totalArea = analysis ? analysis.rooms.reduce((s, r) => s + r.area_m2, 0) : 0;

  const stepper = (
    <ol className="flex flex-wrap items-center gap-2" aria-label={t("plan.title")}>
      {steps.map((s, i) => <Step key={s.label} n={i + 1} label={s.label} state={s.state} />)}
    </ol>
  );

  // ------------------------------------------------------------- no plan yet
  if (!plan || !analysis) {
    return (
      <div className="space-y-4">
        {stepper}
        {error && <Notice kind="error" onClose={() => setError(null)}>{error}</Notice>}
        <Card title={t("plan.upload.title")}>
          <div className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">{t("plan.none")}</p>
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted px-6 py-8 text-center">
              <Icon name="upload" className="h-6 w-6 text-muted-foreground" />
              <div className="text-xs text-muted-foreground">{t("req.planHint")}</div>
              <button type="button" className="btn-primary py-1.5 text-xs" disabled={!!busy || locked} onClick={() => fileRef.current?.click()}>
                {busy === "upload" ? <><Spinner className="h-3.5 w-3.5" /> {t("plan.upload.busy")}</> : t("req.planChoose")}
              </button>
              <div className="text-[11px] text-muted-foreground">{t("req.planSupported")}</div>
              <input ref={fileRef} type="file" accept=".dwg,.dxf" className="sr-only" aria-label={t("plan.upload.title")} onChange={(e) => upload(e.target.files?.[0])} />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const critical = [...analysis.warnings, ...(electrical?.warnings ?? [])].filter((w) => w.severity === "critical");

  return (
    <div className="space-y-5">
      {stepper}
      {error && <Notice kind="error" onClose={() => setError(null)}>{error}</Notice>}
      {info && <Notice kind="success" onClose={() => setInfo(null)}>{info}</Notice>}

      {/* ---------------------------------------------------------- file + analysis */}
      <Card
        title={t("plan.detected")}
        actions={
          !locked && (
            <>
              <button type="button" className="btn-ghost py-1 text-xs" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                {busy === "upload" ? <><Spinner className="h-3.5 w-3.5" /> {t("plan.upload.busy")}</> : t("plan.upload.replace")}
              </button>
              <input ref={fileRef} type="file" accept=".dwg,.dxf" className="sr-only" aria-label={t("plan.upload.replace")} onChange={(e) => upload(e.target.files?.[0])} />
            </>
          )
        }
      >
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-foreground"><Icon name="file" className="h-4 w-4" /> {plan.file.name}</span>
            <span>{plan.file.ext.toUpperCase()}{plan.file.format_version ? ` · ${plan.file.format_version}` : ""}{plan.file.converted_from ? " · converted" : ""}</span>
            <span>{fmtSize(plan.file.size)}</span>
            <span>{t("plan.uploadedBy", { name: plan.file.uploaded_by })} · <LocalTime iso={plan.file.uploaded_at} /></span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label={t("plan.rooms")} value={analysis.rooms.length} />
            <Stat label={t("plan.doors")} value={analysis.openings.filter((o) => o.type === "door").length} />
            <Stat label={t("plan.windows")} value={analysis.openings.filter((o) => o.type === "window").length} />
            <Stat label={t("plan.stairs")} value={analysis.stairs.length} />
            <Stat label={t("plan.area")} value={`${totalArea.toFixed(0)} m²`} />
            <Stat label={t("plan.scale")} value={analysis.scale.unit} note={analysis.scale.assumed ? t("plan.assumed") : analysis.scale.source} />
            <Stat label={t("plan.confidence")} value={<Badge t={analysis.confidence === "high" ? "emerald" : analysis.confidence === "medium" ? "amber" : "red"}>{t(`plan.conf.${analysis.confidence}` as MessageKey)}</Badge>} />
          </div>
          {analysis.warnings.length > 0 && (
            <ul className="space-y-1.5">
              {analysis.warnings.map((w) => (
                <li key={w.id} className={`rounded-md px-3 py-2 text-xs ${w.severity === "critical" ? "bg-danger-soft text-danger" : w.severity === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground"}`}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- viewer */}
      <Card
        title={t("plan.preview")}
        actions={
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {(["architecture", "electrical"] as const).map((m) => (
              <button key={m} type="button" disabled={m === "electrical" && !electrical} onClick={() => setMode(m)} aria-pressed={mode === m} className={`rounded px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {t(`plan.view.${m}` as MessageKey)}
              </button>
            ))}
          </div>
        }
      >
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(["walls", "openings", "labels", "cables"] as const).filter((k) => k !== "cables" || (mode === "electrical" && electrical)).map((k) => (
              <label key={k} className="inline-flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" className="accent-foreground" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                {t(`plan.layer${k[0].toUpperCase()}${k.slice(1)}` as MessageKey)}
              </label>
            ))}
          </div>
          <PlanView analysis={analysis} electrical={electrical} mode={mode} layers={layers} className="h-[min(62vh,560px)]" />
          {mode === "electrical" && electrical && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              <span className="eyebrow self-center">{t("plan.legend")}</span>
              {electrical.legend.map((l) => (
                <span key={l.kind} className="inline-flex items-center gap-1.5">
                  {l.kind === "cable" ? <span className="inline-block h-0 w-5 border-t-2 border-dashed border-accent" /> : <LegendSymbol kind={l.kind} />}
                  {t(`plan.leg.${l.kind}` as MessageKey)} <span className="font-mono text-muted-foreground">{l.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- rooms */}
      <Card title={t("plan.roomsTable")}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>{t("plan.col.room")}</th><th>{t("plan.col.function")}</th><th className="text-right">{t("plan.col.area")}</th><th>{t("plan.col.size")}</th><th>{t("plan.col.doors")}</th></tr>
            </thead>
            <tbody>
              {analysis.rooms.map((r) => {
                const doors = analysis.openings.filter((o) => o.type === "door" && o.between.includes(r.id));
                return (
                  <tr key={r.id}>
                    <td><span className="font-medium">{r.name ?? r.id}</span> <span className="font-mono text-[11px] text-muted-foreground">{r.id}</span></td>
                    <td className="text-xs text-muted-foreground">{r.function}{r.label_source === "inferred" ? " *" : ""}</td>
                    <td className="text-right font-mono tabular-nums">{r.area_m2.toFixed(1)} m²</td>
                    <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{(r.bbox[2] - r.bbox[0]).toFixed(1)} × {(r.bbox[3] - r.bbox[1]).toFixed(1)} m</td>
                    <td className="text-xs">
                      {doors.length === 0 ? "—" : doors.map((d) => {
                        const other = d.between[0] === r.id ? d.between[1] : d.between[0];
                        return <div key={d.id}>{d.id} {t("plan.openingTo", { room: roomName(other) })}{d.swing ? ` · ${d.swing.description}` : ""}</div>;
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------------------------------------------------- electrical plan */}
      <Card title={t("plan.generate.title")}>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <fieldset className="flex flex-wrap gap-x-4 gap-y-2" disabled={!!busy || locked}>
              <legend className="label">{t("plan.include")}</legend>
              {([["lighting", "plan.cfg.lighting"], ["switches", "plan.cfg.switches"], ["sockets", "plan.cfg.sockets"], ["special_sockets", "plan.cfg.special"], ["points", "plan.cfg.points"]] as const).map(([k, label]) => (
                <label key={k} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="checkbox" className="accent-foreground" checked={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.checked })} />
                  {t(label)}
                </label>
              ))}
            </fieldset>
            <div>
              <label htmlFor="supply" className="label">{t("plan.cfg.supply")}</label>
              <select id="supply" className="input w-44" value={cfg.supply} onChange={(e) => setCfg({ ...cfg, supply: e.target.value as typeof cfg.supply })} disabled={!!busy || locked}>
                <option value="auto">{t("plan.cfg.auto")}</option>
                <option value="single_phase">{t("plan.cfg.single")}</option>
                <option value="three_phase">{t("plan.cfg.three")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="lw" className="label">{t("plan.cfg.luminaire")}</label>
              <input id="lw" type="number" min={3} max={200} className="input w-28" value={cfg.luminaire_w} onChange={(e) => setCfg({ ...cfg, luminaire_w: Number(e.target.value) || 18 })} disabled={!!busy || locked} />
            </div>
            <button type="button" className="btn-primary" disabled={!!busy || locked} onClick={generate}>
              {busy === "electrical" ? <><Spinner /> {t("plan.generating")}</> : electrical ? t("plan.regenerate") : t("plan.generate")}
            </button>
          </div>

          {electrical && (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("plan.circuits")}</h3>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="tbl min-w-[820px]">
                    <thead>
                      <tr>
                        <th>{t("plan.col.circuit")}</th><th>{t("plan.col.description")}</th><th>{t("plan.col.protection")}</th><th>{t("plan.col.cable")}</th>
                        <th className="text-right">{t("plan.col.load")}</th><th className="text-right">{t("plan.col.current")}</th><th>{t("plan.col.phase")}</th><th className="text-right">{t("plan.col.length")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {electrical.circuits.map((c) => (
                        <tr key={c.id}>
                          <td className="font-mono text-xs font-semibold">{c.id}</td>
                          <td className="text-[13px]">{c.name}</td>
                          <td className="whitespace-nowrap text-xs">{c.protection}</td>
                          <td className="whitespace-nowrap text-xs">{c.cable}</td>
                          <td className="whitespace-nowrap text-right font-mono tabular-nums">{(c.load_w / 1000).toFixed(2)} kW</td>
                          <td className="text-right font-mono tabular-nums">{c.design_current_a} A</td>
                          <td className="font-mono text-xs">{c.phase}</td>
                          <td className="text-right font-mono tabular-nums">{c.length_m} m</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t("plan.technical")}</h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {([
                      [t("plan.tech.system"), electrical.technical.system],
                      [t("plan.tech.connected"), `${(electrical.technical.connected_load_w / 1000).toFixed(1)} kW`],
                      [t("plan.tech.demand"), `${(electrical.technical.demand_load_w / 1000).toFixed(1)} kW`],
                      [t("plan.tech.current"), `${electrical.technical.design_current_a} A`],
                      [t("plan.tech.main"), electrical.technical.main_protection],
                      [t("plan.tech.cable"), `${electrical.technical.cable_total_m} m`],
                      [t("plan.tech.standards"), electrical.technical.standards.join(", ")],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
                    ))}
                  </dl>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t("plan.assumptions")}</h3>
                  <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {electrical.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              </div>

              {electrical.warnings.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t("plan.warnings")}</h3>
                  <ul className="space-y-1.5">
                    {electrical.warnings.map((w) => (
                      <li key={w.id} className={`rounded-md px-3 py-2 text-xs ${w.severity === "critical" ? "bg-danger-soft text-danger" : w.severity === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground"}`}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="mb-1 text-sm font-semibold">{t("plan.bom")}</h3>
                <p className="mb-2 text-xs text-muted-foreground">{t("plan.materials.hint")}</p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="tbl">
                    <thead><tr><th>{t("plan.col.description")}</th><th>{t("plan.bom.sku")}</th><th className="text-right">{t("rel.col.required")}</th><th>{t("common.status")}</th></tr></thead>
                    <tbody>
                      {electrical.bom.map((b) => {
                        const prod = b.sku ? stock.get(b.sku) : null;
                        const short = prod ? prod.stock_quantity < b.quantity : false;
                        return (
                          <tr key={b.id}>
                            <td className="text-[13px]">{b.description}</td>
                            <td className="font-mono text-[11px] text-muted-foreground">{b.sku ?? "—"}</td>
                            <td className="whitespace-nowrap text-right font-mono tabular-nums">{b.quantity} {b.unit === "meter" ? "m" : b.unit}</td>
                            <td>{b.sku ? <Badge t={short ? "red" : "emerald"}>{short ? t("rel.short") : `${t("plan.bom.stocked")} · ${prod?.stock_quantity ?? 0}`}</Badge> : <Badge t="slate">{t("plan.bom.purchase")}</Badge>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- review + CAD */}
      {electrical && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t("plan.review.title")}>
            <div className="space-y-3 p-5">
              <p className="text-sm text-muted-foreground">{t("plan.review.lead")}</p>
              {critical.length > 0 && !reviewed && <Notice kind="warning">{critical.map((w) => w.message).join(" ")}</Notice>}
              {reviewed ? (
                <Notice kind="success">{t("plan.review.done", { name: plan.reviewed_by ?? "", date: reviewedDate })}</Notice>
              ) : isEngineer ? (
                <button type="button" className="btn-primary" disabled={!!busy || locked} onClick={review}>
                  {busy === "review" ? <><Spinner /> {t("plan.review.confirming")}</> : t("plan.review.confirm")}
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">{t("plan.review.engineerOnly")}</p>
              )}
            </div>
          </Card>

          <Card title={t("plan.cad.title")}>
            <div className="space-y-3 p-5">
              <p className="text-sm text-muted-foreground">{t("plan.cad.lead")}</p>
              {!reviewed && <p className="text-xs text-warning">{t("plan.cad.needsReview")}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={cad ? "btn-ghost" : "btn-primary"} disabled={!!busy || !reviewed || locked} onClick={makeCad}>
                  {busy === "cad" ? <><Spinner /> {t("plan.cad.generating")}</> : t("plan.cad.generate")}
                </button>
                {cad && (
                  <>
                    <a className="btn-ghost" href={`/api/projects/${project.id}/plan/cad`}>{t("plan.cad.download")}</a>
                    <button type="button" className="btn-accent" disabled={!!busy} onClick={openCad}>
                      {busy === "open" ? <><Spinner /> {t("plan.cad.opening")}</> : <><Icon name="external" /> {t("plan.cad.open")}</>}
                    </button>
                  </>
                )}
              </div>
              {cad && (
                <div className="rounded-md bg-muted px-3 py-2 text-xs">
                  <div className="font-medium text-foreground">{t("plan.cad.ready")} · <span className="font-mono">{cad.file_name}</span></div>
                  <div className="mt-0.5 text-muted-foreground">{t("plan.cad.meta", { layers: cad.layers, entities: cad.entities })} · <LocalTime iso={cad.generated_at} /></div>
                  {cad.opened_at && <div className="mt-0.5 text-success">{cad.open_method === "autocad-mcp" ? t("plan.cad.opened") : t("plan.cad.openedOs")} · <LocalTime iso={cad.opened_at} /></div>}
                  {(project.status === "APPROVED" || project.status === "RELEASED") && <div className="mt-1 text-muted-foreground">{t("plan.cad.stale")}</div>}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
