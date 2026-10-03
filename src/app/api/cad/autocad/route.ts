import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, handleAuth } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { AUTOCAD_MCP_URL, AutocadUnavailableError, autocadStatus } from "@/lib/cad/autocad-mcp";
import { exportToAutocad, ServiceError } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

/** GET /api/cad/autocad — is the AutoCAD Electrical MCP server + AutoCAD reachable? */
export async function GET() {
  try {
    await requireUser();
  } catch (err) {
    return errorResponse(err);
  }
  try {
    return NextResponse.json({ reachable: true, url: AUTOCAD_MCP_URL, ...(await autocadStatus()) });
  } catch (err) {
    return NextResponse.json({ reachable: false, url: AUTOCAD_MCP_URL, message: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/cad/autocad — draw the project's schematic in AutoCAD Electrical via MCP and save a DWG. */
export async function POST(req: Request) {
  return handleAuth(async () => {
    const { project_id } = z.object({ project_id: z.string() }).parse(await req.json());
    try {
      return await exportToAutocad(project_id);
    } catch (err) {
      if (err instanceof AutocadUnavailableError) throw new ServiceError(err.message, 503);
      throw err;
    }
  });
}
