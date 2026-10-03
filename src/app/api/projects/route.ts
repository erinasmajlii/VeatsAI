import { z } from "zod";
import { handle } from "@/lib/api";
import { repo } from "@/lib/db";
import { createProject } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => repo().listProjects());
}

/** POST /api/projects — analyse the request with AI and create the project. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = z
      .object({
        request: z.string().min(5).max(5000),
        client_name: z.string().max(200).optional(),
        standard: z.enum(["IEC", "NEC"]).default("IEC"),
        mode: z.enum(["auto", "rule_based"]).optional(),
      })
      .parse(await req.json());
    return createProject(body);
  });
}
