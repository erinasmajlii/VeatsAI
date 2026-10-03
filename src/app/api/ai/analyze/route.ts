import { z } from "zod";
import { analyzeRequest } from "@/lib/ai/analyze";
import { handleAuth } from "@/lib/api";

/** POST /api/ai/analyze — natural language → validated structured JSON (no project is created). */
export async function POST(req: Request) {
  return handleAuth(async () => {
    const body = z.object({ request: z.string().min(5).max(5000), mode: z.enum(["auto", "rule_based"]).optional() }).parse(await req.json());
    return analyzeRequest(body.request, { mode: body.mode });
  });
}
