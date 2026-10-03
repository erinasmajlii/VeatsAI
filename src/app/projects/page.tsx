import Link from "next/link";
import { repo } from "@/lib/db";
import { Card, PageHeader, StatusBadge, eur, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await repo().listProjects();
  return (
    <div>
      <PageHeader title="Projects" subtitle={`${projects.length} project(s)`} actions={<Link href="/projects/new" className="btn-primary">+ New Project</Link>} />
      <div className="p-8">
        <Card>
          {projects.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              No projects yet. <Link href="/projects/new?demo=1" className="font-medium text-emerald-700 hover:underline">Run the demo request →</Link>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Engineer</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Quote total</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td>
                      <Link href={`/projects/${p.id}`} className="font-medium text-slate-900 hover:underline">{p.title}</Link>
                      <div className="max-w-md truncate text-xs text-slate-500">{p.original_request}</div>
                    </td>
                    <td>{p.client_name}</td>
                    <td>{p.engineer}</td>
                    <td><StatusBadge s={p.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(p.created_at)}</td>
                    <td className="text-right tabular-nums">{p.design ? eur(p.design.cost.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
