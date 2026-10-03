import { handle, ReviewActionSchema } from "@/lib/api";
import { reviewProject, type ReviewAction } from "@/lib/projects/service";

/** POST /api/projects/:id/review — engineer edits, acknowledgements, notes, approval. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/review">) {
  return handle(async () => reviewProject((await ctx.params).id, ReviewActionSchema.parse(await req.json()) as ReviewAction));
}
