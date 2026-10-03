import { handleAuth } from "@/lib/api";
import { openPlanInAutocad } from "@/lib/projects/plan-service";

/**
 * POST /api/projects/:id/plan/open — open the generated CAD file in AutoCAD on the server machine
 * (through the AutoCAD service, falling back to the OS default application for .dxf).
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/plan/open">) {
  return handleAuth(async (user) => openPlanInAutocad((await ctx.params).id, user));
}
