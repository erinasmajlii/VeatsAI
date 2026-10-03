import { handleAuth } from "@/lib/api";
import { attachPlan, MAX_PLAN_BYTES } from "@/lib/projects/plan-service";
import { ServiceError } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

/** POST /api/projects/:id/plan (multipart/form-data, field "file") — upload or replace the plan of a project. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/plan">) {
  return handleAuth(async (user) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ServiceError("The upload could not be read. Send the plan as a file.", 400, "BAD_UPLOAD");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ServiceError("Choose an AutoCAD plan (.dwg or .dxf) to upload.", 400, "NO_FILE");
    if (file.size > MAX_PLAN_BYTES) throw new ServiceError(`The file is larger than ${MAX_PLAN_BYTES / 1024 / 1024} MB.`, 413, "FILE_TOO_LARGE");
    return attachPlan((await ctx.params).id, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, user);
  });
}
