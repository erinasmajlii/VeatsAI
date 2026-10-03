import "server-only";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { AutocadUnavailableError, cadOutputDir, convertToDxf, openInAutocad, uploadsDir } from "../cad/autocad-mcp";
import { DEFAULT_COST_SETTINGS } from "../cost";
import { repo } from "../db";
import { analyzeDxf } from "../plan/analyze";
import { buildPlanDxf } from "../plan/cad";
import { decodeDxf, DxfError, dwgVersion, isBinaryDxf, parseDxf } from "../plan/dxf";
import { type ElectricalRequest, generateElectrical } from "../plan/electrical";
import type { PlanAnalysis, ProjectPlan } from "../plan/types";
import type { Project, SessionUser } from "../types";
import { assertEditable, getProjectOrThrow, log, persist, revokeIfApproved, ServiceError } from "./service";

/**
 * Plan workflow: Upload architectural plan → Analyse → Generate electrical plan → Review →
 * Generate CAD file → Open in AutoCAD.
 */

export const MAX_PLAN_BYTES = 30 * 1024 * 1024;
const now = () => new Date().toISOString();
const safeName = (n: string) => path.basename(n).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "plan";
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

interface Ingested {
  plan: ProjectPlan;
  analysis: PlanAnalysis;
}

/** Validates the file, stores it, converts DWG through AutoCAD when needed, parses and analyses it. */
async function ingest(projectId: string, name: string, bytes: Buffer, actor: SessionUser): Promise<Ingested> {
  const ext = path.extname(name).toLowerCase().replace(".", "");
  if (ext !== "dxf" && ext !== "dwg") throw new ServiceError("Only AutoCAD .dwg and .dxf files can be uploaded.", 415, "BAD_FILE_TYPE");
  if (!bytes.length) throw new ServiceError("The file is empty.", 422, "EMPTY_FILE");
  if (bytes.length > MAX_PLAN_BYTES) throw new ServiceError(`The file is larger than ${MAX_PLAN_BYTES / 1024 / 1024} MB.`, 413, "FILE_TOO_LARGE");

  const sha = createHash("sha256").update(bytes).digest("hex");
  const dir = path.join(uploadsDir(), projectId);
  const stored = `${sha.slice(0, 8)}-${safeName(name)}`;
  const full = path.join(dir, stored);

  let dxfText: string;
  let analysedAs = stored;
  let converted: "dwg" | "binary-dxf" | undefined;
  let formatVersion: string | null = null;

  const needsConversion = ext === "dwg" || isBinaryDxf(bytes);
  if (ext === "dwg") {
    formatVersion = dwgVersion(bytes);
    if (!formatVersion) throw new ServiceError("This is not a valid DWG file (unrecognised file header).", 422, "INVALID_DWG");
  }
  if (needsConversion) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(full, bytes);
    try {
      const out = await convertToDxf(full);
      dxfText = decodeDxf(await fs.readFile(out));
      analysedAs = path.relative(uploadsDir(), out).split(path.sep).slice(1).join("/") || path.basename(out);
      converted = ext === "dwg" ? "dwg" : "binary-dxf";
    } catch (err) {
      await fs.rm(full, { force: true });
      if (err instanceof AutocadUnavailableError) {
        throw new ServiceError("DWG files are converted with AutoCAD, which is not reachable right now. Start the AutoCAD service (integrations/autocad-mcp/start.ps1) or upload the drawing as an ASCII DXF.", 503, "DWG_NEEDS_AUTOCAD");
      }
      throw new ServiceError("AutoCAD could not convert this file. Save it as an ASCII DXF and upload that instead.", 422, "DWG_CONVERT_FAILED");
    }
  } else {
    dxfText = decodeDxf(bytes);
  }

  let analysis: PlanAnalysis;
  let version = formatVersion;
  try {
    const doc = parseDxf(dxfText);
    version = version ?? doc.version;
    analysis = analyzeDxf(doc);
  } catch (err) {
    await fs.rm(full, { force: true });
    if (err instanceof DxfError) throw new ServiceError(err.message, 422, "INVALID_DXF");
    throw new ServiceError(err instanceof Error && /wall/i.test(err.message) ? err.message : "The drawing could not be analysed. Check that it is a 2D architectural plan with walls.", 422, "PLAN_ANALYSIS_FAILED");
  }

  if (!needsConversion) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(full, bytes);
  }
  return {
    analysis,
    plan: {
      file: {
        name: path.basename(name), ext, size: bytes.length, sha256: sha, uploaded_at: now(), uploaded_by: actor.name,
        stored_as: `${projectId}/${stored}`, analysed_as: `${projectId}/${analysedAs}`, ...(converted ? { converted_from: converted } : {}), format_version: version,
      },
      analysis, electrical: null, cad: null,
    },
  };
}

/** New project created from an uploaded plan (Requests Portal). */
export async function createPlanProject(input: { name: string; bytes: Buffer; client_name?: string; title?: string; description?: string }, actor: SessionUser): Promise<Project> {
  const id = randomUUID().slice(0, 8);
  const { plan } = await ingest(id, input.name, input.bytes, actor);
  const base = path.basename(input.name, path.extname(input.name));
  const p: Project = {
    id,
    title: input.title?.trim() || `Electrical plan — ${base}`,
    client_name: input.client_name?.trim() || "Unnamed client",
    original_request: input.description?.trim() || `Architectural plan ${plan.file.name}`,
    status: "IN_PROGRESS",
    engineer: actor.role === "engineer" ? actor.name : "Unassigned",
    created_at: now(),
    updated_at: now(),
    analysis: null,
    inputs: null,
    cost_settings: DEFAULT_COST_SETTINGS,
    bom_overrides: {},
    custom_lines: [],
    acknowledged_warnings: {},
    notes: [],
    history: [],
    design: null,
    plan,
  };
  await repo().saveProject(p);
  await log(p, "PLAN_UPLOADED", actor.name, `${plan.file.name} (${plan.analysis?.rooms.length ?? 0} rooms, ${plan.analysis?.openings.length ?? 0} openings)`);
  return persist(p);
}

/** Replaces the plan of an existing project. */
export async function attachPlan(id: string, input: { name: string; bytes: Buffer }, actor: SessionUser): Promise<Project> {
  const p = await getProjectOrThrow(id);
  assertEditable(p);
  const { plan } = await ingest(p.id, input.name, input.bytes, actor);
  await revokeIfApproved(p, actor.name, "Plan replaced — re-approval required.");
  p.plan = plan;
  if (p.status === "DRAFT" || p.status === "APPROVED" || p.status === "ENGINEERING_REVIEW") p.status = p.design ? "ENGINEERING_REVIEW" : "IN_PROGRESS";
  await log(p, "PLAN_UPLOADED", actor.name, `${plan.file.name} (${plan.analysis?.rooms.length ?? 0} rooms)`);
  return persist(p);
}

function planOrThrow(p: Project): ProjectPlan {
  if (!p.plan?.analysis) throw new ServiceError("Upload and analyse an architectural plan first.", 409, "NO_PLAN");
  return p.plan;
}

export async function generateElectricalPlan(id: string, config: ElectricalRequest, actor: SessionUser): Promise<Project> {
  const p = await getProjectOrThrow(id);
  assertEditable(p);
  const plan = planOrThrow(p);
  await revokeIfApproved(p, actor.name, "Electrical plan regenerated — re-approval required.");
  const electrical = generateElectrical(plan.analysis!, config);
  p.plan = { ...plan, electrical, reviewed_by: null, reviewed_by_id: null, reviewed_at: null, cad: null };
  if (!p.design || p.status === "DRAFT" || p.status === "IN_PROGRESS" || p.status === "APPROVED") p.status = "ENGINEERING_REVIEW";
  p.approved_by = null;
  p.approved_by_id = null;
  p.approved_at = null;
  await log(p, "ELECTRICAL_PLAN_GENERATED", actor.name, `${electrical.devices.length} devices, ${electrical.circuits.length} circuits, ${electrical.technical.cable_total_m} m cable`);
  return persist(p);
}

/** The engineer confirms they reviewed the generated plan — required before the CAD file is generated. */
export async function confirmPlanReview(id: string, actor: SessionUser): Promise<Project> {
  if (actor.role !== "engineer") throw new ServiceError("Only engineers can confirm the plan review.", 403, "NOT_ENGINEER");
  const p = await getProjectOrThrow(id);
  assertEditable(p);
  const plan = planOrThrow(p);
  if (!plan.electrical) throw new ServiceError("Generate the electrical plan first.", 409, "NO_ELECTRICAL");
  p.plan = { ...plan, reviewed_by: actor.name, reviewed_by_id: actor.id, reviewed_at: now() };
  await log(p, "PLAN_REVIEWED", actor.name);
  return persist(p);
}

/** Writes the CAD file (original drawing + electrical layers) to the VeatsAI drawings folder. */
export async function generatePlanCad(id: string, actor: SessionUser): Promise<Project> {
  const p = await getProjectOrThrow(id);
  assertEditable(p);
  const plan = planOrThrow(p);
  if (!plan.electrical) throw new ServiceError("Generate the electrical plan first.", 409, "NO_ELECTRICAL");
  if (!plan.reviewed_at) throw new ServiceError("An engineer must confirm the plan review before the CAD file is generated.", 409, "REVIEW_REQUIRED");
  const analysed = path.join(uploadsDir(), plan.file.analysed_as);
  let text: string;
  try {
    text = decodeDxf(await fs.readFile(analysed));
  } catch {
    throw new ServiceError("The uploaded drawing is no longer available on the server. Upload the plan again.", 410, "UPLOAD_MISSING");
  }
  const doc = parseDxf(text);
  const approved = p.status === "APPROVED" || p.status === "RELEASED";
  const built = buildPlanDxf(doc, plan.analysis!, plan.electrical, {
    project_title: p.title, project_id: p.id, client: p.client_name, date: new Date().toISOString().slice(0, 10),
    status: approved ? `APPROVED by ${p.approved_by ?? "engineer"}` : "PRELIMINARY - NOT APPROVED",
  });
  const dir = cadOutputDir();
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${slug(p.title)}-${p.id}-electrical.dxf`;
  const savedPath = path.join(dir, fileName);
  await fs.writeFile(savedPath, built.dxf, "utf8");
  p.plan = { ...plan, cad: { generated_at: now(), file_name: fileName, saved_path: savedPath, entities: built.entities, layers: built.layers } };
  await log(p, "CAD_FILE_GENERATED", actor.name, `${fileName} (${built.entities} entities)`);
  return persist(p);
}

export async function openPlanInAutocad(id: string, actor: SessionUser): Promise<Project> {
  const p = await getProjectOrThrow(id);
  const plan = planOrThrow(p);
  if (!plan.cad) throw new ServiceError("Generate the CAD file first.", 409, "NO_CAD");
  try {
    await fs.access(plan.cad.saved_path);
  } catch {
    throw new ServiceError("The CAD file is missing on the server. Generate it again.", 410, "CAD_MISSING");
  }
  try {
    const r = await openInAutocad(plan.cad.saved_path);
    p.plan = { ...plan, cad: { ...plan.cad, opened_at: now(), open_method: r.method, ...(r.dwg_path ? { dwg_path: r.dwg_path } : {}) } };
    await log(p, "OPENED_IN_AUTOCAD", actor.name, `${plan.cad.file_name} via ${r.method}`);
    return await persist(p);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError("The drawing could not be opened in AutoCAD. Download the DXF and open it manually.", 502, "AUTOCAD_OPEN_FAILED");
  }
}

/** Contents of the generated CAD file for download. */
export async function readPlanCad(id: string): Promise<{ name: string; content: Buffer }> {
  const p = await getProjectOrThrow(id);
  const cad = p.plan?.cad;
  if (!cad) throw new ServiceError("No CAD file has been generated yet.", 404, "NO_CAD");
  const root = path.resolve(cadOutputDir());
  const file = path.resolve(cad.saved_path);
  if (!file.startsWith(root + path.sep)) throw new ServiceError("Invalid file location.", 400);
  try {
    return { name: cad.file_name, content: await fs.readFile(file) };
  } catch {
    throw new ServiceError("The CAD file is missing on the server. Generate it again.", 410, "CAD_MISSING");
  }
}
