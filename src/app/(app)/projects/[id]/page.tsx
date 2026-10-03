import { notFound } from "next/navigation";
import { repo } from "@/lib/db";
import { RULES, STANDARDS } from "@/lib/standards";
import { Workspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const db = repo();
  const [project, products, approvals, movements] = await Promise.all([db.getProject(id), db.listProducts(), db.listApprovals(id), db.listMovements({ project_id: id })]);
  if (!project) notFound();
  return <Workspace initial={project} products={products} standards={STANDARDS} rules={RULES} approvals={approvals} movements={movements} initialTab={tab} />;
}
