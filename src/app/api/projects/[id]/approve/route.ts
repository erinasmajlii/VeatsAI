import { handleAuth } from "@/lib/api";
import { approveProject } from "@/lib/projects/service";

/**
 * POST /api/projects/:id/approve — engineer approval.
 * Requires an authenticated ENGINEER (checked against the database, not the client). The approval (engineer id,
 * name, project, timestamp, status) is stored in project_approvals and on the project. Returns the updated project.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/approve">) {
  return handleAuth(async (user) => (await approveProject((await ctx.params).id, user)).project, { engineer: true });
}
