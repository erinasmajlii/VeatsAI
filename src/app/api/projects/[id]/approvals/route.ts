import { handleAuth } from "@/lib/api";
import { repo } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/projects/:id/approvals — approval history (who approved, when, whether revoked). */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/approvals">) {
  return handleAuth(async () => repo().listApprovals((await ctx.params).id));
}
