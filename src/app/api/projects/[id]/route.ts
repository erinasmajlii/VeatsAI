import { handleAuth } from "@/lib/api";
import { getProjectOrThrow } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handleAuth(async () => getProjectOrThrow((await ctx.params).id));
}
