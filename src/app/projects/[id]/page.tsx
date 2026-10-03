import { notFound } from "next/navigation";
import { repo } from "@/lib/db";
import { RULES, STANDARDS } from "@/lib/standards";
import { Workspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, products] = await Promise.all([repo().getProject(id), repo().listProducts()]);
  if (!project) notFound();
  return <Workspace initial={project} products={products} standards={STANDARDS} rules={RULES} />;
}
