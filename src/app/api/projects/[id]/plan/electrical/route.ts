import { z } from "zod";
import { handleAuth } from "@/lib/api";
import { generateElectricalPlan } from "@/lib/projects/plan-service";

/** POST /api/projects/:id/plan/electrical — generate the electrical plan on the analysed architecture. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/plan/electrical">) {
  return handleAuth(async (user) => {
    const body = z
      .object({
        lighting: z.boolean().optional(),
        switches: z.boolean().optional(),
        sockets: z.boolean().optional(),
        special_sockets: z.boolean().optional(),
        points: z.boolean().optional(),
        supply: z.enum(["auto", "single_phase", "three_phase"]).optional(),
        luminaire_w: z.coerce.number().min(3).max(200).optional(),
      })
      .parse(await req.json().catch(() => ({})));
    return generateElectricalPlan((await ctx.params).id, body, user);
  });
}
