import { handleAuth } from "@/lib/api";
import { repo } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/inventory/movements?project_id=&limit= — recorded stock changes. */
export async function GET(req: Request) {
  return handleAuth(async () => {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    return repo().listMovements({ project_id: url.searchParams.get("project_id") ?? undefined, limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100 });
  });
}
