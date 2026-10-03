import { z } from "zod";
import { handle } from "@/lib/api";
import { generateCAD } from "@/lib/cad";
import { getProjectOrThrow, ServiceError } from "@/lib/projects/service";

/** POST /api/cad/generate — CAD contract + SVG + DXF for a project. */
export async function POST(req: Request) {
  return handle(async () => {
    const { project_id } = z.object({ project_id: z.string() }).parse(await req.json());
    const p = await getProjectOrThrow(project_id);
    if (!p.design) throw new ServiceError("Generate the engineering design first.");
    return generateCAD(p.title, p.design.calculation, p.design.bom);
  });
}
