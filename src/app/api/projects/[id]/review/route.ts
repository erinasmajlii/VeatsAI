import { handleAuth, ReviewActionSchema } from "@/lib/api";
import { reviewProject, type ReviewAction } from "@/lib/projects/service";

/** POST /api/projects/:id/review — edits, acknowledgements, notes (the signed-in user is the author). */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/review">) {
  return handleAuth(async (user) => reviewProject((await ctx.params).id, ReviewActionSchema.parse(await req.json()) as ReviewAction, user));
}
