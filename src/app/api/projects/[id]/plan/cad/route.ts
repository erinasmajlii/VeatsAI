import { errorResponse, handleAuth } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { generatePlanCad, readPlanCad } from "@/lib/projects/plan-service";

export const dynamic = "force-dynamic";

/** POST /api/projects/:id/plan/cad — generate the CAD file (original drawing + electrical layers). */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/plan/cad">) {
  return handleAuth(async (user) => generatePlanCad((await ctx.params).id, user));
}

/** GET /api/projects/:id/plan/cad — download the generated DXF. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/plan/cad">) {
  try {
    await requireUser();
    const { name, content } = await readPlanCad((await ctx.params).id);
    return new Response(new Uint8Array(content), { headers: { "content-type": "application/dxf", "content-disposition": `attachment; filename="${name}"` } });
  } catch (err) {
    return errorResponse(err);
  }
}
