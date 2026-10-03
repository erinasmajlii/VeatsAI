import Link from "next/link";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";
import { repo } from "@/lib/db";
import { eur, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const { t, lang } = await getT();
  const [quotes, projects] = await Promise.all([repo().listQuotes(), repo().listProjects()]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  return (
    <div>
      <PageHeader eyebrow={t("nav.quotes")} title={t("page.quotes.title")} subtitle={t("page.quotes.sub")} />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Card>
          {quotes.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">{t("page.quotes.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("page.quotes.col.quote")}</th>
                    <th>{t("common.project")}</th>
                    <th>{t("common.client")}</th>
                    <th>{t("page.quotes.col.quoteStatus")}</th>
                    <th>{t("page.quotes.col.projectStatus")}</th>
                    <th>{t("common.created")}</th>
                    <th className="text-right">{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const p = byId.get(q.project_id);
                    return (
                      <tr key={q.id} className="hover:bg-muted/60">
                        <td><Link href={`/projects/${q.project_id}/quote`} className="font-mono text-xs font-medium hover:underline">{q.quote_number}</Link></td>
                        <td>{p ? <Link href={`/dashboard?p=${p.id}`} className="hover:underline">{p.title}</Link> : q.project_id}</td>
                        <td>{p?.client_name ?? "—"}</td>
                        <td>{q.status === "ISSUED" ? <Badge t="emerald">{t("page.quotes.issued")}</Badge> : <Badge t="amber">{t("page.quotes.draft")}</Badge>}</td>
                        <td>{p && <StatusBadge s={p.status} />}</td>
                        <td className="text-xs text-muted-foreground">{fmtDate(q.created_at, lang)}</td>
                        <td className="text-right font-mono tabular-nums">{eur(Number(q.total))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
