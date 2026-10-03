import Link from "next/link";
import { repo } from "@/lib/db";
import { Badge, Card, PageHeader, StatusBadge, eur, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const [quotes, projects] = await Promise.all([repo().listQuotes(), repo().listProjects()]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  return (
    <div>
      <PageHeader title="Quotes" subtitle="Quotes are generated from project designs. Only engineer-approved projects produce issued quotes." />
      <div className="p-8">
        <Card>
          {quotes.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">No quotes yet. Open a project and click “Generate Quote”.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Quote</th><th>Project</th><th>Client</th><th>Quote status</th><th>Project status</th><th>Created</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const p = byId.get(q.project_id);
                  return (
                    <tr key={q.id} className="hover:bg-slate-50">
                      <td><Link href={`/projects/${q.project_id}/quote`} className="font-mono text-xs font-semibold hover:underline">{q.quote_number}</Link></td>
                      <td>{p ? <Link href={`/projects/${p.id}`} className="hover:underline">{p.title}</Link> : q.project_id}</td>
                      <td>{p?.client_name ?? "—"}</td>
                      <td>{q.status === "ISSUED" ? <Badge t="emerald">Issued</Badge> : <Badge t="amber">Draft</Badge>}</td>
                      <td>{p && <StatusBadge s={p.status} />}</td>
                      <td className="text-xs text-slate-500">{fmtDate(q.created_at)}</td>
                      <td className="text-right tabular-nums">{eur(Number(q.total))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
