import Link from "next/link";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";
import { repo } from "@/lib/db";
import { eur, fmtDate } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import type { ProjectStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: MessageKey; match: ProjectStatus[] | null }[] = [
  { key: "all", label: "page.projects.filter.all", match: null },
  { key: "progress", label: "page.projects.filter.progress", match: ["DRAFT", "IN_PROGRESS", "MISSING_INFORMATION", "AI_PROCESSING", "NEEDS_CHANGES"] },
  { key: "pending", label: "page.projects.filter.pending", match: ["ENGINEERING_REVIEW"] },
  { key: "approved", label: "page.projects.filter.approved", match: ["APPROVED"] },
  { key: "released", label: "page.projects.filter.released", match: ["RELEASED"] },
];

/** The only place that lists projects (the assistant panel never duplicates this). */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { t, lang } = await getT();
  const all = await repo().listProjects();
  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const projects = filter.match ? all.filter((p) => filter.match!.includes(p.status)) : all;
  return (
    <div>
      <PageHeader
        eyebrow={t("nav.projects")}
        title={t("page.projects.title")}
        subtitle={t("page.projects.sub", { n: projects.length })}
        actions={<Link href="/requests" className="btn-primary">+ {t("nav.newRequest")}</Link>}
      />
      <div className="mx-auto max-w-7xl space-y-4 px-5 py-6 sm:px-8">
        <nav className="flex flex-wrap gap-1.5" aria-label={t("nav.projects")}>
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/projects" : `/projects?status=${f.key}`}
              aria-current={f.key === filter.key ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${f.key === filter.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {t(f.label)}
              <span className="ml-1.5 opacity-60">{f.match ? all.filter((p) => f.match!.includes(p.status)).length : all.length}</span>
            </Link>
          ))}
        </nav>
        <Card>
          {projects.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {t("page.projects.empty")} <Link href="/requests" className="font-medium text-foreground hover:underline">{t("page.projects.demo")}</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("page.projects.col.project")}</th>
                    <th>{t("common.client")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("common.engineer")}</th>
                    <th>{t("common.updated")}</th>
                    <th className="text-right">{t("page.projects.col.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/60">
                      <td>
                        <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                        {p.plan && <> <Badge t="blue">{t("page.projects.plan")}</Badge></>}
                        <div className="max-w-md truncate text-xs text-muted-foreground">{p.original_request}</div>
                      </td>
                      <td>{p.client_name}</td>
                      <td><StatusBadge s={p.status} /></td>
                      <td className="text-sm">{p.approved_by ?? (p.engineer === "Unassigned" ? "—" : p.engineer)}</td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(p.updated_at, lang)}</td>
                      <td className="text-right font-mono tabular-nums">{p.design ? eur(p.design.cost.total) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
