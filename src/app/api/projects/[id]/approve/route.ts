import { handle } from "@/lib/api";
import { reviewProject } from "@/lib/projects/service";

/** POST /api/projects/:id/approve — engineer approval (blocked while critical warnings are unacknowledged). */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/approve">) {
  return handle(async () => reviewProject((await ctx.params).id, { type: "approve" }));
}
