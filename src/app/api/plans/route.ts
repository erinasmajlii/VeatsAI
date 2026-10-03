import { handleAuth } from "@/lib/api";
import { createPlanProject, MAX_PLAN_BYTES } from "@/lib/projects/plan-service";
import { ServiceError } from "@/lib/projects/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/plans (multipart/form-data) — upload an AutoCAD plan (.dwg / .dxf).
 * Validates the file, analyses the architecture and creates a project holding the plan.
 * Fields: file, client_name?, title?, description?
 */
export async function POST(req: Request) {
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
    const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string).slice(0, 2000) : undefined);
    return createPlanProject({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()), client_name: str("client_name"), title: str("title"), description: str("description") }, user);
  });
}
