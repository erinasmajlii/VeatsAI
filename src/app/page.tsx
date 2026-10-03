import Link from "next/link";
import { aiConfigured } from "@/lib/ai/analyze";
import { repo } from "@/lib/db";
import { productStockStatus } from "@/lib/inventory";
import { Card, PageHeader, SafetyBanner, StatusBadge, StockBadge, eur, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const FLOW = ["Client request", "AI understanding", "Missing info", "Engineering engine", "Standards rules", "Components & BOM", "Inventory", "Cost", "CAD", "Quote", "Engineer review", "Approval"];

const HOW: [string, string][] = [
  ["Describe", "Write the client request in plain language."],
  ["AI understands", "Extracts inputs; missing data is flagged, never guessed."],
  ["Engineering", "Deterministic calculations referencing standards."],
  ["BOM & cost", "Components, stock check and price from inventory."],
  ["Engineer approves", "Results are preliminary until reviewed and approved."],
];

export default async function Dashboard() {
  const db = repo();
  const [projects, products] = await Promise.all([db.listProjects(), db.listProducts()]);
  const inReview = projects.filter((p) => p.status === "ENGINEERING_REVIEW" || p.status === "NEEDS_CHANGES").length;
  const approved = projects.filter((p) => p.status === "APPROVED");
  const pipeline = projects.reduce((s, p) => s + (p.design?.cost.total ?? 0), 0);
  const alerts = products.filter((p) => productStockStatus(p) !== "IN_STOCK");

  const kpis = [
    { label: "Projects", value: projects.length },
    { label: "Awaiting engineer review", value: inReview },
    { label: "Approved", value: approved.length },
    { label: "Quoted pipeline", value: eur(pipeline) },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="From natural language → engineering → standards → BOM → inventory → cost → CAD → quote → engineer approval"
        actions={
          <Link href="/projects/new" className="btn-primary">
            + Create New Project
          </Link>
        }
      />
      <div className="space-y-6 p-8">
        <SafetyBanner />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="card px-5 py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{k.value}</div>
            </div>
          ))}
        </div>

        <Card title="How it works">
          <ol className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
            {HOW.map(([t, d], i) => (
              <li key={t} className="rounded-lg bg-slate-50 p-3">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">{i + 1}</span>
                <div className="mt-2 text-sm font-semibold text-slate-900">{t}</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{d}</p>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="VeatsAI workflow">
          <div className="flex flex-wrap items-center gap-1.5 px-5 py-4 text-xs">
            {FLOW.map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">{s}</span>
                {i < FLOW.length - 1 && <span className="text-slate-400">→</span>}
              </span>
            ))}
          </div>
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            AI: {aiConfigured() ? "connected (request understanding only)" : "not configured — rule-based parser in use"} · Database: {db.backend === "supabase" ? "Supabase" : "local file (demo)"} · Calculations: deterministic engine
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Recent projects" className="lg:col-span-2" actions={<Link href="/projects" className="text-xs font-medium text-slate-600 hover:underline">View all</Link>}>
            {projects.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">
                No projects yet.{" "}
                <Link href="/projects/new?demo=1" className="font-medium text-emerald-700 hover:underline">
                  Start with the demo request →
                </Link>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.slice(0, 8).map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td>
                        <Link href={`/projects/${p.id}`} className="font-medium text-slate-900 hover:underline">
                          {p.title}
                        </Link>
                        <div className="text-xs text-slate-500">{fmtDate(p.created_at)}</div>
                      </td>
                      <td>{p.client_name}</td>
                      <td>
                        <StatusBadge s={p.status} />
                      </td>
                      <td className="text-right tabular-nums">{p.design ? eur(p.design.cost.total) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Inventory alerts" actions={<Link href="/inventory" className="text-xs font-medium text-slate-600 hover:underline">Inventory</Link>}>
            <ul className="divide-y divide-slate-100">
              {alerts.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">All items above minimum stock.</li>}
              {alerts.map((p) => (
                <li key={p.sku} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.stock_quantity} {p.unit} · min {p.min_stock_level}
                    </div>
                  </div>
                  <StockBadge s={productStockStatus(p)} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
