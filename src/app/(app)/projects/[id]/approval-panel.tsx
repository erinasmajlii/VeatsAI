"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/components/api-error";
import { Icon } from "@/components/icons";
import { useT } from "@/components/i18n";
import { Badge, Modal, Notice, Spinner } from "@/components/ui";
import { useUser } from "@/components/user-context";
import { LocalTime } from "@/components/local-time";
import type { MessageKey } from "@/lib/i18n";
import type { ReleasePreviewLine } from "@/lib/projects/materials";
import { LIFECYCLE, lifecycleIndex } from "@/lib/projects/status";
import type { InventoryMovement, Project, ProjectApproval, UnstockedMaterial } from "@/lib/types";

/** Draft → In progress → Pending approval → Approved → Released. */
export function Lifecycle({ status }: { status: Project["status"] }) {
  const t = useT();
  const current = lifecycleIndex(status);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label={t("life.title")}>
      {LIFECYCLE.map((s, i) => {
        const done = i < current, now = i === current;
        return (
          <li key={s} aria-current={now ? "step" : undefined} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${now ? "bg-primary text-primary-foreground" : done ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
            {done ? <Icon name="check" className="h-3.5 w-3.5" /> : <span className={`h-1.5 w-1.5 rounded-full ${now ? "bg-primary-foreground" : "bg-muted-foreground/60"}`} />}
            {t(`life.step.${s}` as MessageKey)}
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

interface Preview {
  lines: ReleasePreviewLine[];
  unstocked: UnstockedMaterial[];
  can_release: boolean;
}

function ReleaseDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: (r: { project: Project; movements: InventoryMovement[] }) => void }) {
  const t = useT();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Preview>(`/api/projects/${project.id}/release`).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data as Preview);
      else setError(errorMessage(t, r.data));
    });
    return () => { alive = false; };
  }, [project.id, t]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await api<{ project: Project; movements: InventoryMovement[] }>(`/api/projects/${project.id}/release`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setError(errorMessage(t, r.data));
    onDone(r.data as { project: Project; movements: InventoryMovement[] });
  }

  return (
    <Modal title={t("rel.confirmTitle")} onClose={busy ? () => {} : onClose} wide>
      <div className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">{t("rel.confirmTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("rel.confirmLead")}</p>
        </div>
        {!preview && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> {t("rel.loading")}</div>}
        {preview && (
          <>
            {preview.lines.length === 0 ? (
              <Notice kind="warning">{t("rel.none")}</Notice>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="tbl">
                  <thead>
                    <tr><th>{t("rel.col.item")}</th><th className="text-right">{t("rel.col.required")}</th><th className="text-right">{t("rel.col.stock")}</th><th className="text-right">{t("rel.col.after")}</th></tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l) => (
                      <tr key={l.sku} className={l.ok ? "" : "bg-danger-soft"}>
                        <td><div className="text-[13px]">{l.name}</div><div className="font-mono text-[11px] text-muted-foreground">{l.sku}</div></td>
                        <td className="text-right font-mono tabular-nums">−{l.required}</td>
                        <td className="text-right font-mono tabular-nums">{l.stock ?? "—"}</td>
                        <td className={`text-right font-mono tabular-nums ${l.ok ? "" : "font-semibold text-danger"}`}>{l.after ?? "—"}{!l.ok && <div className="text-[11px] font-medium">{t("rel.short")}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.unstocked.length > 0 && (
              <div>
                <div className="eyebrow mb-1.5">{t("rel.notDeducted")}</div>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {preview.unstocked.map((u, i) => <li key={i}>{u.quantity} {u.unit === "meter" ? "m" : u.unit} · {u.description}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>{t("rel.cancel")}</button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={busy || !preview || !preview.can_release}>
            {busy ? <><Spinner /> {t("rel.releasing")}</> : t("rel.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Engineer approval and inventory release for a project.
 * Approve → records the engineer (id, name), project and time in the database.
 * Release → deducts the project's materials from inventory, exactly once.
 */
export function ApprovalPanel({
  project, approvals, movements, ready, openCritical, onProject, onApprovals, onMovements, onToast, extraActions,
}: {
  project: Project;
  approvals: ProjectApproval[];
  movements: InventoryMovement[];
  ready: boolean;
  openCritical: number;
  onProject: (p: Project) => void;
  onApprovals: (a: ProjectApproval[]) => void;
  onMovements: (m: InventoryMovement[]) => void;
  onToast: (msg: string) => void;
  extraActions?: React.ReactNode;
}) {
  const t = useT();
  const user = useUser();
  const isEngineer = user.role === "engineer";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);

  const status = project.status;
  const approved = status === "APPROVED";
  const released = status === "RELEASED";
  const canApprove = status === "ENGINEERING_REVIEW" || status === "NEEDS_CHANGES";
  const active = approvals.find((a) => a.status === "APPROVED");
  const revoked = approvals.filter((a) => a.status === "REVOKED");

  async function refresh() {
    const [p, a] = await Promise.all([api<Project>(`/api/projects/${project.id}`), api<ProjectApproval[]>(`/api/projects/${project.id}/approvals`)]);
    if (p.ok) onProject(p.data as Project);
    if (a.ok) onApprovals(a.data as unknown as ProjectApproval[]);
  }

  async function approve() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await api<Project>(`/api/projects/${project.id}/approve`, { method: "POST" });
    if (r.ok) {
      onProject(r.data as Project);
      const a = await api<ProjectApproval[]>(`/api/projects/${project.id}/approvals`);
      if (a.ok) onApprovals(a.data as unknown as ProjectApproval[]);
      onToast(t("proj.toast.approved2"));
    } else {
      setError(errorMessage(t, r.data));
      // someone else may have approved in the meantime — show the real state
      if (r.data.code === "ALREADY_APPROVED" || r.data.code === "ALREADY_RELEASED" || r.data.code === "BAD_STATUS") await refresh();
    }
    setBusy(false);
  }

  const headline = t(`status.${status}` as MessageKey);
  const tint = released ? "bg-primary/[0.03]" : approved ? "bg-success-soft" : "bg-muted";

  return (
    <section id="approval" aria-label={t("appr.title2")} className={`card overflow-hidden ${approved ? "border-success/40" : ""}`}>
      <div className={`flex flex-wrap items-start justify-between gap-4 px-5 py-4 ${tint}`}>
        <div className="min-w-0">
          <div className="eyebrow">{t("appr.title2")}</div>
          <div className={`mt-1 text-xl font-semibold tracking-tight ${approved ? "text-success" : ""}`}>{headline}</div>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            {released
              ? t("proj.locked")
              : approved
                ? isEngineer ? t("rel.lead") : t("rel.engineerOnly")
                : status === "NEEDS_CHANGES"
                  ? t("appr.needsChanges")
                  : !ready
                    ? t("appr.notReady")
                    : canApprove
                      ? isEngineer ? t("appr.pendingEngineer") : t("appr.engineerOnly", { role: t(`role.${user.role}` as MessageKey) })
                      : t("appr.pendingOther")}
          </p>
          {canApprove && openCritical > 0 && <p className="mt-1 text-sm font-medium text-danger">{t("appr.criticalOpen", { n: openCritical })}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {extraActions}
          {canApprove && (
            <button type="button" className="btn-primary px-5" disabled={busy || !isEngineer || !ready || openCritical > 0} onClick={approve} title={!isEngineer ? t("appr.engineerOnly", { role: t(`role.${user.role}` as MessageKey) }) : undefined}>
              {busy ? <><Spinner /> {t("appr.approving")}</> : <><Icon name="check" /> {t("appr.approve")}</>}
            </button>
          )}
          {approved && (
            <button type="button" className="btn-primary px-5" disabled={!isEngineer} onClick={() => { setError(null); setReleasing(true); }} title={!isEngineer ? t("rel.engineerOnly") : undefined}>
              {t("rel.button")}
            </button>
          )}
          {approved && <Badge t="emerald">{t("appr.approvedState")}</Badge>}
          {released && <Badge t="dark">{t("status.RELEASED")}</Badge>}
        </div>
      </div>

      {error && <div className="px-5 pt-4"><Notice kind="error" onClose={() => setError(null)}>{error}</Notice></div>}

      {(approved || released) && (
        <dl className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t("appr.approvedBy")} value={project.approved_by ?? active?.engineer_name ?? "—"} />
          <Detail label={t("appr.approvedOn")} value={<LocalTime iso={project.approved_at} />} />
          <Detail label={t("appr.approvalId")} value={<span className="font-mono text-xs">{active ? active.id.slice(0, 8).toUpperCase() : "—"}</span>} />
          {released && <Detail label={t("rel.releasedBy")} value={project.released_by ?? "—"} />}
          {released && <Detail label={t("rel.releasedOn")} value={<LocalTime iso={project.released_at} />} />}
        </dl>
      )}
      {approved && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{t("appr.revokeNote")}</p>}

      {released && movements.length > 0 && (
        <div className="border-t border-border">
          <div className="px-5 pt-4 text-sm font-semibold">{t("rel.movements")}</div>
          <div className="max-h-64 overflow-auto px-2 pb-2">
            <table className="tbl">
              <thead><tr><th>{t("rel.col.item")}</th><th className="text-right">{t("inv.mv.change")}</th><th className="text-right">{t("inv.mv.balance")}</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs">{m.sku}</td>
                    <td className="text-right font-mono tabular-nums text-danger">{m.quantity_change}</td>
                    <td className="text-right font-mono tabular-nums">{m.stock_before} → {m.stock_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-5 py-2.5 text-xs"><Link href="/inventory" className="font-medium text-accent hover:underline">{t("nav.inventory")} →</Link></div>
        </div>
      )}

      {revoked.length > 0 && (
        <details className="border-t border-border px-5 py-3 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">{t("appr.history")} ({approvals.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {approvals.map((a) => (
              <li key={a.id}>
                {a.engineer_name} · <LocalTime iso={a.approved_at} /> {a.status === "REVOKED" && <Badge t="amber">{t("appr.revoked")}</Badge>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {releasing && (
        <ReleaseDialog
          project={project}
          onClose={() => setReleasing(false)}
          onDone={(r) => {
            setReleasing(false);
            onProject(r.project);
            onMovements(r.movements);
            onToast(t("proj.toast.released"));
          }}
        />
      )}
    </section>
  );
}
