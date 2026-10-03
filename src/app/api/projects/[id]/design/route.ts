import { z } from "zod";
import { handleAuth, InputPatchSchema } from "@/lib/api";
import { generateDesign } from "@/lib/projects/service";

/** POST /api/projects/:id/design — fill missing info and run the full engineering pipeline. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/design">) {
  return handleAuth(async (user) => {
    const body = z.object({ patch: InputPatchSchema.optional() }).parse(await req.json().catch(() => ({})));
    return generateDesign((await ctx.params).id, body.patch, user);
  });
}
