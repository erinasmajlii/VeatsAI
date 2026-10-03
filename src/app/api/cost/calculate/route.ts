import { z } from "zod";
import { handle } from "@/lib/api";
import { calculateCost } from "@/lib/cost";
import { getProjectOrThrow, ServiceError } from "@/lib/projects/service";

/** POST /api/cost/calculate — cost preview for a project with an alternative margin (does not persist). */
export async function POST(req: Request) {
  return handle(async () => {
    const body = z.object({ project_id: z.string(), margin_pct: z.coerce.number().min(0).max(100).optional() }).parse(await req.json());
    const p = await getProjectOrThrow(body.project_id);
    if (!p.design) throw new ServiceError("Generate the engineering design first.");
    return calculateCost(p.design.bom, { ...p.cost_settings, ...(body.margin_pct !== undefined ? { margin_pct: body.margin_pct } : {}) });
  });
}
