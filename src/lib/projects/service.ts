import "server-only";
import { randomUUID } from "crypto";
import { analyzeRequest } from "../ai/analyze";
import { bomWarnings, finalizeBom, generateBaseBom } from "../bom";
import { buildCadContract, generateCAD } from "../cad";
import { drawInAutocad } from "../cad/autocad-mcp";
import { COMPANY } from "../config";
import { calculateCost, DEFAULT_COST_SETTINGS, resolveCostSettings } from "../cost";
import { RepoError, repo } from "../db";
import { calculateDesign, InsufficientDataError } from "../engineering/calculate";
import { applyInputPatch, buildDesignInputs, findMissing } from "../engineering/inputs";
import { isFamilyImplemented } from "../standards";
import type { BomOverride, CostSettings, DesignInputs, InventoryMovement, Project, ProjectApproval, ProjectStatus, Quote, SessionUser, StandardFamily, UnstockedMaterial } from "../types";
import { projectMaterials } from "./materials";
import { isApprovedStatus } from "./status";

/**
 * Project service — orchestrates the workflow:
 * request → AI understanding → missing info → engineering → standards → components/BOM
 * → inventory → cost → CAD → quote → engineer review → approval.
 */

export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const fmtWhen = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

/** Turns storage-level errors into messages a user can act on. Raw database text never reaches the UI. */
export function mapRepoError(e: unknown): unknown {
  if (!(e instanceof RepoError)) return e;
  const d = (e.details ?? {}) as Record<string, unknown>;
  switch (e.code) {
    case "NOT_FOUND": return new ServiceError("Project not found.", 404, e.code);
    case "ALREADY_APPROVED": return new ServiceError(`This project is already approved${d.approved_by ? ` by ${d.approved_by}` : ""}${d.approved_at ? ` on ${fmtWhen(String(d.approved_at))}` : ""}.`, 409, e.code, d);
    case "ALREADY_RELEASED": return new ServiceError("This project has already been released. Inventory was deducted once and will not be deducted again.", 409, e.code, d);
    case "NOT_APPROVED": return new ServiceError("Only an approved project can be released. Approve it first.", 409, e.code, d);
    case "BAD_STATUS": return new ServiceError(`This project is not ready for approval (status: ${String(d.status ?? "unknown")}).`, 409, e.code, d);
    case "NOT_ENGINEER": return new ServiceError("Only engineers can perform this action.", 403, e.code);
    case "INSUFFICIENT_STOCK": {
      const sh = (d.shortages as { name?: string; sku: string; required: number; available: number; unit?: string }[] | undefined) ?? [];
      return new ServiceError(`Not enough stock to release: ${sh.map((x) => `${x.name ?? x.sku} (need ${x.required}, have ${x.available})`).join("; ")}. Nothing was deducted.`, 409, e.code, d);
    }
    case "MISSING_MATERIAL": return new ServiceError(`These materials are not in the inventory: ${((d.skus as string[]) ?? []).join(", ")}. Nothing was deducted.`, 409, e.code, d);
    case "NO_MATERIALS": return new ServiceError("This project has no stocked materials to deduct.", 409, e.code);
    default: return new ServiceError("The database is unavailable right now. Please try again.", 503, "DATABASE");
  }
}

function requireEngineerRole(actor: SessionUser) {
  if (actor.role !== "engineer") throw new ServiceError("Only engineers can perform this action.", 403, "NOT_ENGINEER");
}

/** Released projects are locked: their materials were already deducted from inventory. */
export function assertEditable(p: Project) {
  if (p.status === "RELEASED") throw new ServiceError("This project has been released and is locked.", 409, "LOCKED");
}

const now = () => new Date().toISOString();

function event(action: string, author: string, detail?: string) {
  return { id: randomUUID(), action, author, detail, created_at: now() };
}

export async function log(p: Project, action: string, author: string, detail?: string) {
  const e = event(action, author, detail);
  p.history.push(e);
  try {
    await repo().recordReview(p.id, e);
  } catch {
    // Review log is secondary — never block the workflow on it.
  }
}

function statusFromInputs(inputs: DesignInputs): ProjectStatus {
  const m = findMissing({
    motors: inputs.motors,
    voltage: inputs.voltage.value,
    starting_method: inputs.starting_method.value,
    cable_length_m: inputs.cable_length_m.value,
    environment: inputs.environment.value,
    installation_method: inputs.installation_method.value,
    ambient_temperature_c: inputs.ambient_temperature_c.value,
    short_circuit_current_ka: inputs.short_circuit_current_ka.value,
  });
  return m.critical.length ? "MISSING_INFORMATION" : "DRAFT";
}

export async function createProject(opts: {
  request: string;
  client_name?: string;
  standard?: StandardFamily;
  mode?: "auto" | "rule_based";
}, actor: SessionUser): Promise<Project> {
  const standard = opts.standard ?? "IEC";
  if (!isFamilyImplemented(standard)) throw new ServiceError(`${standard} rules are not implemented yet. Select IEC.`);
  const analysis = await analyzeRequest(opts.request, { mode: opts.mode });
  const inputs = buildDesignInputs(analysis, standard);
  const p: Project = {
    id: randomUUID().slice(0, 8),
    title: analysis.project_title || "Electrical project",
    client_name: opts.client_name?.trim() || analysis.client_name || "Unnamed client",
    original_request: opts.request.trim(),
    status: statusFromInputs(inputs),
    engineer: actor.role === "engineer" ? actor.name : "Unassigned",
    created_at: now(),
    updated_at: now(),
    analysis,
    inputs,
    cost_settings: DEFAULT_COST_SETTINGS,
    bom_overrides: {},
    custom_lines: [],
    acknowledged_warnings: {},
    notes: [],
    history: [],
    design: null,
  };
  await repo().saveProject(p);
  await log(p, "CREATED", actor.name, `Request analysed. Missing: ${analysis.missing_information.join(", ") || "none"}`);
  await repo().saveProject(p);
  return p;
}

export async function getProjectOrThrow(id: string): Promise<Project> {
  const p = await repo().getProject(id);
  if (!p) throw new ServiceError("Project not found", 404);
  return p;
}

/** Re-run the deterministic pipeline from current inputs + engineer overrides. */
async function regenerate(p: Project): Promise<Project> {
  if (!p.inputs) throw new ServiceError("Insufficient engineering data.");
  const products = await repo().listProducts();
  let calc;
  try {
    calc = calculateDesign(p.inputs);
  } catch (err) {
    if (err instanceof InsufficientDataError) {
      p.status = "MISSING_INFORMATION";
      throw new ServiceError(`Insufficient engineering data: ${err.missing.join(", ")}.`);
    }
    throw err;
  }
  const base = generateBaseBom(calc, products);
  const bom = finalizeBom(base, p.bom_overrides, p.custom_lines, products);
  calc.warnings = [...calc.warnings, ...bomWarnings(bom, calc, products)].map((w) => ({
    ...w,
    acknowledged: Boolean(p.acknowledged_warnings[w.id]),
    acknowledged_by: p.acknowledged_warnings[w.id],
  }));
  p.cost_settings = resolveCostSettings(p.cost_settings, calc);
  const cost = calculateCost(bom, p.cost_settings);
  let cad = null;
  let cad_error: string | undefined;
  try {
    cad = await generateCAD(p.title, calc, bom);
  } catch (err) {
    cad_error = `CAD preview unavailable. ${err instanceof Error ? err.message : ""}`.trim();
  }
  p.design = { calculation: calc, bom, cost, cad, ...(cad_error ? { cad_error } : {}), generated_at: now() };
  return p;
}

export async function persist(p: Project) {
  p.updated_at = now();
  await repo().saveProject(p);
  return p;
}

/** Any edit invalidates a previous approval — the engineer must re-approve. */
export async function revokeIfApproved(p: Project, author: string, reason: string) {
  if (p.status !== "APPROVED") return;
  await repo().revokeApprovals(p.id, reason, now());
  await log(p, "APPROVAL_REVOKED", author, reason);
  p.approved_by = null;
  p.approved_by_id = null;
  p.approved_at = null;
}

async function markEdited(p: Project, author: string) {
  assertEditable(p);
  await revokeIfApproved(p, author, "Design edited after approval — re-approval required.");
  if (p.design) p.status = "ENGINEERING_REVIEW";
}

export async function generateDesign(id: string, patch: Partial<Record<keyof DesignInputs, unknown>> | undefined, actor: SessionUser) {
  const author = actor.name;
  const p = await getProjectOrThrow(id);
  assertEditable(p);
  if (!p.inputs) throw new ServiceError("Insufficient engineering data.");
  if (patch && Object.keys(patch).length) p.inputs = applyInputPatch(p.inputs, patch, "USER_PROVIDED");
  if (statusFromInputs(p.inputs) === "MISSING_INFORMATION") {
    p.status = "MISSING_INFORMATION";
    await persist(p);
    throw new ServiceError("Insufficient engineering data — critical information is still missing.");
  }
  p.status = "AI_PROCESSING";
  await regenerate(p);
  await revokeIfApproved(p, author, "Design regenerated — re-approval required.");
  p.status = "ENGINEERING_REVIEW";
  p.approved_by = null;
  p.approved_by_id = null;
  p.approved_at = null;
  await log(p, "DESIGN_GENERATED", `Engineering engine (run by ${author})`, `Total ${p.design!.cost.total.toFixed(2)} EUR, ${p.design!.bom.length} BOM lines, ${p.design!.calculation.warnings.length} warnings.`);
  return persist(p);
}

export type ReviewAction =
  | { type: "update_inputs"; patch: Partial<Record<keyof DesignInputs, unknown>> }
  | { type: "bom_override"; line_id: string; override: BomOverride | null }
  | { type: "add_line"; sku: string; quantity: number }
  | { type: "cost_settings"; settings: Partial<Pick<CostSettings, "labor_rate_eur_h" | "engineering_rate_eur_h" | "margin_pct">> & { labor_hours?: number | null; engineering_hours?: number | null } }
  | { type: "ack_warning"; warning_id: string; acknowledged: boolean }
  | { type: "add_note"; text: string }
  | { type: "request_changes"; reason: string }
  | { type: "update_meta"; title?: string; client_name?: string };

export async function reviewProject(id: string, action: ReviewAction, actor: SessionUser): Promise<Project> {
  const author = actor.name;
  const p = await getProjectOrThrow(id);
  assertEditable(p);
  const needsDesign = () => {
    if (!p.design) throw new ServiceError("Generate the engineering design first.");
  };

  switch (action.type) {
    case "update_inputs": {
      if (!p.inputs) throw new ServiceError("Insufficient engineering data.");
      p.inputs = applyInputPatch(p.inputs, action.patch, "ENGINEER_OVERRIDE");
      if (p.design) {
        await markEdited(p, author);
        await regenerate(p);
      }
      await log(p, "INPUTS_EDITED", author, Object.keys(action.patch).join(", "));
      break;
    }
    case "bom_override": {
      needsDesign();
      if (action.override === null) delete p.bom_overrides[action.line_id];
      else p.bom_overrides[action.line_id] = { ...p.bom_overrides[action.line_id], ...action.override };
      if (action.override?.removed && p.custom_lines.some((c) => c.id === action.line_id)) {
        p.custom_lines = p.custom_lines.filter((c) => c.id !== action.line_id);
        delete p.bom_overrides[action.line_id];
      }
      await markEdited(p, author);
      await regenerate(p);
      await log(p, "COMPONENT_EDITED", author, `${action.line_id}: ${JSON.stringify(action.override)}`);
      break;
    }
    case "add_line": {
      needsDesign();
      p.custom_lines.push({ id: `custom.${randomUUID().slice(0, 6)}`, sku: action.sku, quantity: Math.max(1, action.quantity) });
      await markEdited(p, author);
      await regenerate(p);
      await log(p, "COMPONENT_ADDED", author, action.sku);
      break;
    }
    case "cost_settings": {
      needsDesign();
      const s = action.settings;
      const cs = { ...p.cost_settings };
      if (s.margin_pct !== undefined) cs.margin_pct = s.margin_pct;
      if (s.labor_rate_eur_h !== undefined) cs.labor_rate_eur_h = s.labor_rate_eur_h;
      if (s.engineering_rate_eur_h !== undefined) cs.engineering_rate_eur_h = s.engineering_rate_eur_h;
      if (s.labor_hours !== undefined) cs.labor_hours = s.labor_hours === null ? DEFAULT_COST_SETTINGS.labor_hours : { value: s.labor_hours, provenance: "ENGINEER_OVERRIDE" };
      if (s.engineering_hours !== undefined) cs.engineering_hours = s.engineering_hours === null ? DEFAULT_COST_SETTINGS.engineering_hours : { value: s.engineering_hours, provenance: "ENGINEER_OVERRIDE" };
      p.cost_settings = cs;
      await markEdited(p, author);
      await regenerate(p);
      await log(p, "COST_EDITED", author, JSON.stringify(s));
      break;
    }
    case "ack_warning": {
      needsDesign();
      if (action.acknowledged) p.acknowledged_warnings[action.warning_id] = author;
      else delete p.acknowledged_warnings[action.warning_id];
      for (const w of p.design!.calculation.warnings) {
        if (w.id === action.warning_id) {
          w.acknowledged = action.acknowledged;
          w.acknowledged_by = action.acknowledged ? author : undefined;
        }
      }
      await log(p, action.acknowledged ? "WARNING_ACKNOWLEDGED" : "WARNING_REOPENED", author, action.warning_id);
      break;
    }
    case "add_note": {
      if (!action.text.trim()) throw new ServiceError("Note is empty.");
      p.notes.push({ id: randomUUID(), author, text: action.text.trim(), created_at: now() });
      await log(p, "NOTE_ADDED", author);
      break;
    }
    case "request_changes": {
      needsDesign();
      await revokeIfApproved(p, author, "Changes requested after approval.");
      p.status = "NEEDS_CHANGES";
      p.approved_by = null;
      p.approved_by_id = null;
      p.approved_at = null;
      if (action.reason.trim()) p.notes.push({ id: randomUUID(), author, text: `Changes requested: ${action.reason.trim()}`, created_at: now() });
      await log(p, "CHANGES_REQUESTED", author, action.reason);
      break;
    }
    case "update_meta": {
      if (action.title?.trim()) p.title = action.title.trim();
      if (action.client_name?.trim()) p.client_name = action.client_name.trim();
      await log(p, "DETAILS_EDITED", author);
      break;
    }
  }
  return persist(p);
}

export function quoteNumber(p: Project): string {
  return `Q-${p.created_at.slice(0, 4)}-${p.id.toUpperCase()}`;
}

export async function generateQuote(id: string, actor: SessionUser): Promise<Quote> {
  const p = await getProjectOrThrow(id);
  if (!p.design) throw new ServiceError("Generate the engineering design before creating a quote.");
  const q: Quote = {
    id: `q-${p.id}`,
    project_id: p.id,
    quote_number: quoteNumber(p),
    total: p.design.cost.total,
    status: isApprovedStatus(p.status) ? "ISSUED" : "DRAFT",
    approval_status: p.status,
    created_at: now(),
  };
  await repo().saveQuote(q, { company: COMPANY.name, project: p.title, client: p.client_name, cost: p.design.cost, bom: p.design.bom });
  await log(p, "QUOTE_GENERATED", actor.name, `${q.quote_number} (${q.status})`);
  await persist(p);
  return q;
}

/** Draw the project's schematic in AutoCAD Electrical through the MCP integration and record the DWG. */
export async function exportToAutocad(id: string) {
  const p = await getProjectOrThrow(id);
  if (!p.design) throw new ServiceError("Generate the engineering design before exporting to AutoCAD.");
  const contract = buildCadContract(p.title, p.design.calculation, p.design.bom);
  const result = await drawInAutocad(contract);
  p.design.autocad_export = { ...result, exported_at: now() };
  await log(p, "AUTOCAD_EXPORTED", "AutoCAD Electrical (MCP)", `${result.dwg_path} — ${result.symbols_inserted} symbols`);
  await persist(p);
  return p.design.autocad_export;
}

// ------------------------------------------------------------------ approval & release

/**
 * Engineer approval. The approval is written to the database (project_approvals + the project row) in one
 * atomic step and only ever for an authenticated engineer; a second approval is rejected.
 */
export async function approveProject(id: string, actor: SessionUser): Promise<{ project: Project; approval: ProjectApproval }> {
  requireEngineerRole(actor);
  const p = await getProjectOrThrow(id);
  if (!p.design && !p.plan?.electrical) throw new ServiceError("Generate the engineering design or the electrical plan before approval.", 409, "NOT_READY");
  try {
    const { project, approval } = await repo().approveProject({
      project_id: id,
      engineer: { id: actor.id, name: actor.name },
      now: now(),
      total_eur: p.design?.cost.total ?? null,
      validate: (fresh) => {
        const open = fresh.design?.calculation.warnings.filter((w) => w.severity === "critical" && !w.acknowledged) ?? [];
        if (open.length) throw new ServiceError(`${open.length} critical warning(s) must be acknowledged before approval.`, 409, "CRITICAL_WARNINGS", { count: open.length });
        const planCritical = [...(fresh.plan?.analysis?.warnings ?? []), ...(fresh.plan?.electrical?.warnings ?? [])].filter((w) => w.severity === "critical");
        if (planCritical.length && !fresh.plan?.reviewed_at) throw new ServiceError("The plan has critical warnings. Confirm the plan review before approval.", 409, "PLAN_REVIEW_REQUIRED");
      },
    });
    await log(project, "APPROVED", actor.name, `Approval ${approval.id.slice(0, 8)}${approval.total_eur !== null ? ` · total ${approval.total_eur.toFixed(2)} EUR` : ""}`);
    await repo().saveProject(project);
    return { project, approval };
  } catch (e) {
    throw mapRepoError(e);
  }
}

/**
 * Official release: deducts the project's exact materials from the global inventory, records every
 * movement and marks the project RELEASED — one atomic operation (see db/index.ts). Releasing twice is
 * rejected and never deducts twice.
 */
export async function releaseProject(id: string, actor: SessionUser): Promise<{ project: Project; movements: InventoryMovement[]; not_deducted: UnstockedMaterial[] }> {
  requireEngineerRole(actor);
  const p = await getProjectOrThrow(id);
  const { requirements, unstocked } = projectMaterials(p);
  try {
    const { project, movements } = await repo().releaseProject({ project_id: id, actor: { id: actor.id, name: actor.name }, now: now(), requirements });
    await log(project, "RELEASED", actor.name, movements.map((m) => `${m.sku} ${m.quantity_change}`).join(", "));
    await repo().saveProject(project);
    return { project, movements, not_deducted: unstocked };
  } catch (e) {
    throw mapRepoError(e);
  }
}
