import { z } from "zod";
import { handleAuth } from "@/lib/api";
import { generateQuote } from "@/lib/projects/service";

/** POST /api/quotes/generate — create/refresh the quote record for a project. */
export async function POST(req: Request) {
  return handleAuth(async (user) => generateQuote(z.object({ project_id: z.string() }).parse(await req.json()).project_id, user));
}
