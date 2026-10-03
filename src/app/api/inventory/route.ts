import { handleAuth } from "@/lib/api";
import { repo } from "@/lib/db";
import { productStockStatus } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** GET /api/inventory — products with stock status. */
export async function GET() {
  return handleAuth(async () => (await repo().listProducts()).map((p) => ({ ...p, stock_status: productStockStatus(p) })));
}
