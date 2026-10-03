import { handleAuth } from "@/lib/api";
import { aiConfigured, aiModel, aiProvider } from "@/lib/ai/analyze";
import { CAD_ADAPTERS } from "@/lib/cad";
import { repo } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleAuth(async () => ({
    ai: { configured: aiConfigured(), provider: aiProvider(), model: aiModel() },
    database: repo().backend,
    cad_adapters: CAD_ADAPTERS.map(({ id, name, status }) => ({ id, name, status })),
  }));
}
