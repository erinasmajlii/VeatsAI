import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatusBadge } from "@/components/ui";
import { repo } from "@/lib/db";
import { eur } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { productStockStatus } from "@/lib/inventory";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

function Kpi({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="card px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 font-mono text-3xl font-medium tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function ProjectList({ projects, empty }: { projects: Project[]; empty: string }) {
  if (!projects.length) return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {projects.slice(0, 6).map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-4 px-5 py-3 transition hover:bg-muted">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{p.title}</div>
              <div className="truncate text-xs text-muted-foreground">{p.client_name}</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden font-mono text-xs text-muted-foreground sm:block">{p.design ? eur(p.design.cost.total) : ""}</span>
              <StatusBadge s={p.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Overview: where projects stand and what needs attention. Requests and projects live on their own pages. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  if (p) redirect(`/projects/${encodeURIComponent(p)}`); // old links: /dashboard?p=<id>
  const { t } = await getT();
  const db = repo();
  const [projects, products] = await Promise.all([db.listProjects(), db.listProducts()]);
  const by = (...s: Project["status"][]) => projects.filter((x) => s.includes(x.status));
  const pending = by("ENGINEERING_REVIEW");
  const approved = by("APPROVED");
  const inProgress = by("DRAFT", "IN_PROGRESS", "MISSING_INFORMATION", "AI_PROCESSING", "NEEDS_CHANGES");
  const low = products.filter((x) => productStockStatus(x) !== "IN_STOCK").sort((a, b) => a.stock_quantity - b.stock_quantity);

  return (
    <div>
      <PageHeader
        title={t("nav.dashboard")}
        subtitle={t("dash.sub")}
        actions={
          <>
            <Link href="/requests" className="btn-primary">+ {t("nav.newRequest")}</Link>
          </>
        }
      />
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label={t("dash.kpi.open")} value={pending.length + approved.length + inProgress.length} note={t("dash.kpi.open.note", { n: inProgress.length })} />
          <Kpi label={t("dash.kpi.pending")} value={pending.length} note={t("dash.kpi.pending.note")} />
          <Kpi label={t("dash.kpi.ready")} value={approved.length} note={t("dash.kpi.ready.note")} />
          <Kpi label={t("dash.kpi.low")} value={low.length} note={t("dash.kpi.low.note")} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="card">
            <div className="card-h">
              <h2 className="card-t">{t("dash.awaiting")}</h2>
              <Link href="/projects" className="text-xs font-medium text-accent hover:underline">{t("dash.viewAll")}</Link>
            </div>
            <ProjectList projects={pending} empty={t("dash.empty")} />
          </section>
          <section className="card">
            <div className="card-h">
              <h2 className="card-t">{t("dash.ready")}</h2>
            </div>
            <ProjectList projects={approved} empty={t("dash.empty")} />
          </section>
        </div>

        <section className="card">
          <div className="card-h">
            <h2 className="card-t">{t("dash.lowStock")}</h2>
            <Link href="/inventory" className="text-xs font-medium text-accent hover:underline">{t("nav.inventory")} →</Link>
          </div>
          {low.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("dash.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {low.slice(0, 6).map((x) => (
                <li key={x.sku} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{x.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{x.sku}</div>
                  </div>
                  <span className={`shrink-0 font-mono tabular-nums ${x.stock_quantity <= 0 ? "text-danger" : "text-warning"}`}>{x.stock_quantity} {x.unit === "meter" ? "m" : x.unit}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
