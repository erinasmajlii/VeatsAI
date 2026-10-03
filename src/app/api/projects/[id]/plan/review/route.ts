import { handleAuth } from "@/lib/api";
import { confirmPlanReview } from "@/lib/projects/plan-service";

/** POST /api/projects/:id/plan/review — an engineer confirms the generated electrical plan was reviewed. */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/plan/review">) {
  return handleAuth(async (user) => confirmPlanReview((await ctx.params).id, user), { engineer: true });
}
