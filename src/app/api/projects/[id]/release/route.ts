import { handleAuth } from "@/lib/api";
import { repo } from "@/lib/db";
import { releasePreview } from "@/lib/projects/materials";
import { getProjectOrThrow, releaseProject } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

/** GET /api/projects/:id/release — what a release would deduct, against current stock (read-only). */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/release">) {
  return handleAuth(async () => {
    const [p, products] = await Promise.all([getProjectOrThrow((await ctx.params).id), repo().listProducts()]);
    return releasePreview(p, products);
  });
}

/**
 * POST /api/projects/:id/release — official release (engineers only).
 * Deducts the exact materials from the global inventory in one atomic operation, records every movement and
 * marks the project RELEASED. A second release is rejected and never deducts again.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/release">) {
  return handleAuth(async (user) => releaseProject((await ctx.params).id, user), { engineer: true });
}
