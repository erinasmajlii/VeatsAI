import Link from "next/link";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { repo } from "@/lib/db";
import { eur, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { t, lang } = await getT();
  const projects = await repo().listProjects();
  return (
    <div>
      <PageHeader
        eyebrow={t("nav.projects")}
        title={t("page.projects.title")}
        subtitle={t("page.projects.sub", { n: projects.length })}
        actions={<Link href="/dashboard" className="btn-primary">+ {t("nav.newRequest")}</Link>}
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Card>
          {projects.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {t("page.projects.empty")} <Link href="/dashboard" className="font-medium text-foreground hover:underline">{t("page.projects.demo")}</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("page.projects.col.project")}</th>
                    <th>{t("common.client")}</th>
                    <th>{t("common.engineer")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("common.created")}</th>
                    <th className="text-right">{t("page.projects.col.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/60">
                      <td>
                        <Link href={`/dashboard?p=${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                        <div className="max-w-md truncate text-xs text-muted-foreground">{p.original_request}</div>
                      </td>
                      <td>{p.client_name}</td>
                      <td>{p.engineer}</td>
                      <td><StatusBadge s={p.status} /></td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(p.created_at, lang)}</td>
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
