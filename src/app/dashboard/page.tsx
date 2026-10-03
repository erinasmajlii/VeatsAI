import { aiModel, aiProvider } from "@/lib/ai/analyze";
import { repo } from "@/lib/db";
import { RULES, STANDARDS } from "@/lib/standards";
import { EngineerPanel } from "./panel";

export const dynamic = "force-dynamic";

/** Engineer panel: request portal | project (stages 01–08) | inventory — the main working screen. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const db = repo();
  const [projects, products] = await Promise.all([db.listProjects(), db.listProducts()]);
  const selected = p ? (projects.find((x) => x.id === p) ?? null) : null;
  return (
    <EngineerPanel
      projects={projects}
      products={products}
      initialProject={selected}
      standards={STANDARDS}
      rules={RULES}
      ai={{ provider: aiProvider(), model: aiModel() }}
    />
  );
}
