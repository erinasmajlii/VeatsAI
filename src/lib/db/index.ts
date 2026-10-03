import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "../data-dir";
import { SEED_PRODUCTS } from "../inventory/catalog";
import { STANDARDS } from "../standards";
import type { InventoryMovement, MaterialRequirement, Product, Project, ProjectApproval, Quote, ReviewEvent, UserRecord } from "../types";

/**
 * Data access layer.
 *
 * - Supabase (Postgres) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (server-side only).
 * - Otherwise a local JSON file (.data/db.json, or $VEATS_DATA_DIR/db.json) so the demo runs with zero setup.
 *
 * Both backends seed the product catalog automatically on first access.
 *
 * Approval and release are ATOMIC in both backends:
 * - Postgres: `approve_project` / `release_project` functions (supabase/migrations/0002_*.sql) run in one
 *   transaction under row locks; unique constraints make a second deduction impossible.
 * - Local JSON: every mutation runs inside a process-wide lock and the file is only written when the whole
 *   operation succeeded, so a failed release never leaves a half-applied deduction.
 */

export type RepoErrorCode =
  | "NOT_FOUND"
  | "BAD_STATUS"
  | "ALREADY_APPROVED"
  | "ALREADY_RELEASED"
  | "NOT_APPROVED"
  | "NOT_ENGINEER"
  | "INSUFFICIENT_STOCK"
  | "MISSING_MATERIAL"
  | "NO_MATERIALS"
  | "DATABASE";

export class RepoError extends Error {
  constructor(
    public code: RepoErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface ApproveInput {
  project_id: string;
  engineer: { id: string; name: string };
  now: string;
  total_eur: number | null;
  /** Business checks run against the freshest project (inside the lock for the local backend). */
  validate?: (p: Project) => void;
}
export interface ReleaseInput {
  project_id: string;
  actor: { id: string; name: string };
  now: string;
  requirements: MaterialRequirement[];
  validate?: (p: Project) => void;
}

export interface Repo {
  backend: "supabase" | "local";
  listProducts(): Promise<Product[]>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(p: Project): Promise<void>;
  recordReview(projectId: string, e: ReviewEvent): Promise<void>;
  listQuotes(): Promise<Quote[]>;
  saveQuote(q: Quote, snapshot: unknown): Promise<void>;
  seed(): Promise<{ products: number; standards: number }>;
  // users
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  createUser(u: UserRecord): Promise<void>;
  touchLogin(id: string): Promise<void>;
  // approval
  approveProject(input: ApproveInput): Promise<{ project: Project; approval: ProjectApproval }>;
  revokeApprovals(projectId: string, reason: string, now: string): Promise<void>;
  listApprovals(projectId: string): Promise<ProjectApproval[]>;
  // release / inventory
  releaseProject(input: ReleaseInput): Promise<{ project: Project; movements: InventoryMovement[] }>;
  listMovements(opts?: { project_id?: string; limit?: number }): Promise<InventoryMovement[]>;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Sum requirements per SKU, dropping empty lines. */
function aggregate(reqs: MaterialRequirement[]): Map<string, { name: string; quantity: number; unit: string }> {
  const m = new Map<string, { name: string; quantity: number; unit: string }>();
  for (const r of reqs) {
    if (!(r.quantity > 0)) continue;
    const cur = m.get(r.sku);
    if (cur) cur.quantity = round3(cur.quantity + r.quantity);
    else m.set(r.sku, { name: r.name, quantity: round3(r.quantity), unit: r.unit });
  }
  return m;
}

// ------------------------------------------------------------------ local

interface LocalDb {
  products: Product[];
  projects: Project[];
  quotes: Quote[];
  reviews: (ReviewEvent & { project_id: string })[];
  users: UserRecord[];
  approvals: ProjectApproval[];
  movements: InventoryMovement[];
}

const localFile = () => path.join(dataDir(), "db.json");

function normalize(db: LocalDb): LocalDb {
  db.users ??= [];
  db.approvals ??= [];
  db.movements ??= [];
  // Approvals recorded before engineer accounts existed become legacy records (no engineer id).
  for (const p of db.projects) {
    if ((p.status === "APPROVED" || p.status === "RELEASED") && p.approved_at && !db.approvals.some((a) => a.project_id === p.id)) {
      db.approvals.push({
        id: `legacy-${p.id}`, project_id: p.id, engineer_id: null, engineer_name: p.approved_by ?? "Unknown engineer",
        status: "APPROVED", approved_at: p.approved_at, total_eur: p.design?.cost.total ?? null, legacy: true,
      });
    }
  }
  return db;
}

async function readLocal(): Promise<LocalDb> {
  try {
    return normalize(JSON.parse(await fs.readFile(localFile(), "utf8")) as LocalDb);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new RepoError("DATABASE", "The local database could not be read.");
    const fresh: LocalDb = { products: SEED_PRODUCTS, projects: [], quotes: [], reviews: [], users: [], approvals: [], movements: [] };
    await writeLocal(fresh);
    return fresh;
  }
}

async function writeLocal(db: LocalDb) {
  const file = localFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, file);
}

// One lock for the whole process, shared by every route bundle.
const lockHolder = globalThis as unknown as { __veatsDbLock?: Promise<unknown> };
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = (lockHolder.__veatsDbLock ?? Promise.resolve()).then(fn, fn);
  lockHolder.__veatsDbLock = run.catch(() => undefined);
  return run;
}
/** Read-modify-write under the lock. Nothing is written when `fn` throws. */
function mutate<T>(fn: (db: LocalDb) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const db = await readLocal();
    const result = await fn(db);
    await writeLocal(db);
    return result;
  });
}

function assertEngineer(db: LocalDb, id: string) {
  const u = db.users.find((x) => x.id === id);
  if (!u || !u.active || u.role !== "engineer") throw new RepoError("NOT_ENGINEER", "Only an active engineer account can do this.");
}

const localRepo: Repo = {
  backend: "local",
  async listProducts() {
    return (await readLocal()).products;
  },
  async listProjects() {
    return (await readLocal()).projects.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async getProject(id) {
    return (await readLocal()).projects.find((p) => p.id === id) ?? null;
  },
  async saveProject(p) {
    await mutate((db) => {
      const i = db.projects.findIndex((x) => x.id === p.id);
      if (i >= 0) db.projects[i] = p;
      else db.projects.push(p);
    });
  },
  async recordReview(projectId, e) {
    await mutate((db) => { db.reviews.push({ ...e, project_id: projectId }); });
  },
  async listQuotes() {
    return (await readLocal()).quotes.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async saveQuote(q) {
    await mutate((db) => {
      const i = db.quotes.findIndex((x) => x.id === q.id);
      if (i >= 0) db.quotes[i] = q;
      else db.quotes.push(q);
    });
  },
  /** Adds catalogue items that are missing. Existing stock levels are never reset. */
  async seed() {
    await mutate((db) => {
      const have = new Set(db.products.map((p) => p.sku));
      for (const p of SEED_PRODUCTS) if (!have.has(p.sku)) db.products.push(p);
    });
    return { products: SEED_PRODUCTS.length, standards: STANDARDS.length };
  },

  async getUserByEmail(email) {
    const e = email.trim().toLowerCase();
    return (await readLocal()).users.find((u) => u.email.toLowerCase() === e) ?? null;
  },
  async getUserById(id) {
    return (await readLocal()).users.find((u) => u.id === id) ?? null;
  },
  async createUser(u) {
    await mutate((db) => {
      if (db.users.some((x) => x.email.toLowerCase() === u.email.toLowerCase())) throw new RepoError("DATABASE", "A user with this email already exists.");
      db.users.push({ ...u, email: u.email.toLowerCase() });
    });
  },
  async touchLogin(id) {
    await mutate((db) => { const u = db.users.find((x) => x.id === id); if (u) u.last_login_at = new Date().toISOString(); });
  },

  async approveProject(input) {
    return mutate((db) => {
      const p = db.projects.find((x) => x.id === input.project_id);
      if (!p) throw new RepoError("NOT_FOUND", "Project not found.");
      if (p.status === "RELEASED") throw new RepoError("ALREADY_RELEASED", "This project has already been released.");
      if (p.status === "APPROVED") throw new RepoError("ALREADY_APPROVED", "This project is already approved.", { approved_by: p.approved_by, approved_at: p.approved_at });
      if (p.status !== "ENGINEERING_REVIEW" && p.status !== "NEEDS_CHANGES") throw new RepoError("BAD_STATUS", "This project is not ready for approval.", { status: p.status });
      assertEngineer(db, input.engineer.id);
      input.validate?.(p);
      const approval: ProjectApproval = {
        id: randomUUID(), project_id: p.id, engineer_id: input.engineer.id, engineer_name: input.engineer.name,
        status: "APPROVED", approved_at: input.now, total_eur: input.total_eur,
      };
      db.approvals.push(approval);
      p.status = "APPROVED";
      p.approved_by = input.engineer.name;
      p.approved_by_id = input.engineer.id;
      p.approved_at = input.now;
      p.updated_at = input.now;
      return { project: structuredClone(p), approval };
    });
  },
  async revokeApprovals(projectId, reason, now) {
    await mutate((db) => {
      for (const a of db.approvals) if (a.project_id === projectId && a.status === "APPROVED") { a.status = "REVOKED"; a.revoked_at = now; a.revoked_reason = reason; }
    });
  },
  async listApprovals(projectId) {
    return (await readLocal()).approvals.filter((a) => a.project_id === projectId).sort((a, b) => b.approved_at.localeCompare(a.approved_at));
  },

  async releaseProject(input) {
    return mutate((db) => {
      const p = db.projects.find((x) => x.id === input.project_id);
      if (!p) throw new RepoError("NOT_FOUND", "Project not found.");
      if (p.status === "RELEASED") throw new RepoError("ALREADY_RELEASED", "This project has already been released.", { released_at: p.released_at, released_by: p.released_by });
      if (p.status !== "APPROVED") throw new RepoError("NOT_APPROVED", "Only an approved project can be released.", { status: p.status });
      assertEngineer(db, input.actor.id);
      if (db.movements.some((m) => m.project_id === p.id && m.reason === "PROJECT_RELEASE")) throw new RepoError("ALREADY_RELEASED", "Inventory was already deducted for this project.");
      input.validate?.(p);

      const need = aggregate(input.requirements);
      if (!need.size) throw new RepoError("NO_MATERIALS", "This project has no stocked materials to release.");
      const bySku = new Map(db.products.map((x) => [x.sku, x]));
      const missing = [...need.keys()].filter((sku) => !bySku.has(sku));
      if (missing.length) throw new RepoError("MISSING_MATERIAL", "Some materials are not in the inventory.", { skus: missing });
      const short = [...need.entries()]
        .filter(([sku, n]) => bySku.get(sku)!.stock_quantity < n.quantity)
        .map(([sku, n]) => ({ sku, name: bySku.get(sku)!.name, required: n.quantity, available: bySku.get(sku)!.stock_quantity, unit: n.unit }));
      if (short.length) throw new RepoError("INSUFFICIENT_STOCK", "Not enough stock to release this project.", { shortages: short });

      // every check passed — apply everything (the file is only written if this function returns)
      const movements: InventoryMovement[] = [];
      for (const [sku, n] of [...need.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const prod = bySku.get(sku)!;
        const before = prod.stock_quantity;
        const after = round3(before - n.quantity);
        prod.stock_quantity = after;
        movements.push({
          id: randomUUID(), sku, project_id: p.id, quantity_change: -n.quantity, stock_before: before, stock_after: after,
          reason: "PROJECT_RELEASE", actor_id: input.actor.id, actor_name: input.actor.name, created_at: input.now,
        });
      }
      db.movements.push(...movements);
      p.status = "RELEASED";
      p.released_at = input.now;
      p.released_by = input.actor.name;
      p.released_by_id = input.actor.id;
      p.updated_at = input.now;
      return { project: structuredClone(p), movements };
    });
  },
  async listMovements(opts = {}) {
    const all = (await readLocal()).movements.filter((m) => !opts.project_id || m.project_id === opts.project_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts.limit ? all.slice(0, opts.limit) : all;
  },
};

// --------------------------------------------------------------- supabase

let sb: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!sb) {
    sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return sb;
}

/** Raw database messages never reach the UI. */
function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) {
    console.error("Supabase error:", res.error.message);
    throw new RepoError("DATABASE", "A database error occurred. Please try again.");
  }
  return res.data;
}

/** The SQL functions raise `VEATS:<CODE>[:<detail>]`. */
function rpcError(err: { message: string }): never {
  const m = /VEATS:([A-Z_]+)(?::([\s\S]*))?/.exec(err.message);
  if (!m) {
    console.error("Supabase rpc error:", err.message);
    throw new RepoError("DATABASE", "A database error occurred. Please try again.");
  }
  const code = m[1] as RepoErrorCode;
  const detail = m[2];
  let details: unknown = detail;
  if (code === "INSUFFICIENT_STOCK" && detail) { try { details = { shortages: JSON.parse(detail) }; } catch { /* keep raw */ } }
  if (code === "MISSING_MATERIAL") details = { skus: (detail ?? "").split(",").filter(Boolean) };
  if (code === "ALREADY_APPROVED") details = { approved_by: detail };
  throw new RepoError(code, code, details);
}

type ProductRow = Omit<Product, "stock_quantity"> & { inventory: { stock_quantity: number } | { stock_quantity: number }[] | null };

let seeded = false;
const userFromRow = (r: Record<string, unknown>): UserRecord => ({
  id: String(r.id), name: String(r.name), email: String(r.email), role: r.role as UserRecord["role"], password_hash: String(r.password_hash ?? ""),
  active: r.active !== false, created_at: String(r.created_at), last_login_at: (r.last_login_at as string | null) ?? null,
});
const approvalFromRow = (r: Record<string, unknown>): ProjectApproval => ({
  id: String(r.id), project_id: String(r.project_id), engineer_id: (r.engineer_id as string | null) ?? null, engineer_name: String(r.engineer_name),
  status: r.status as ProjectApproval["status"], approved_at: String(r.approved_at), revoked_at: (r.revoked_at as string | null) ?? null,
  revoked_reason: (r.revoked_reason as string | null) ?? null, total_eur: r.total_eur === null ? null : Number(r.total_eur), legacy: Boolean(r.legacy),
});
const movementFromRow = (r: Record<string, unknown>): InventoryMovement => ({
  id: String(r.id), sku: String(r.sku), project_id: String(r.project_id), quantity_change: Number(r.quantity_change), stock_before: Number(r.stock_before),
  stock_after: Number(r.stock_after), reason: r.reason as InventoryMovement["reason"], actor_id: (r.actor_id as string | null) ?? null,
  actor_name: String(r.actor_name), created_at: String(r.created_at),
});

const supabaseRepo: Repo = {
  backend: "supabase",
  async listProducts() {
    let rows = check(await supabase().from("products").select("*, inventory(stock_quantity)").order("sku")) as ProductRow[];
    if (!rows.length && !seeded) {
      seeded = true;
      await this.seed();
      rows = check(await supabase().from("products").select("*, inventory(stock_quantity)").order("sku")) as ProductRow[];
    }
    return rows.map(({ inventory, ...p }) => ({
      ...p,
      purchase_price_eur: Number(p.purchase_price_eur),
      selling_price_eur: Number(p.selling_price_eur),
      stock_quantity: Number((Array.isArray(inventory) ? inventory[0] : inventory)?.stock_quantity ?? 0),
    }));
  },
  async listProjects() {
    return check(await supabase().from("projects").select("*").order("created_at", { ascending: false })) as Project[];
  },
  async getProject(id) {
    return check(await supabase().from("projects").select("*").eq("id", id).maybeSingle()) as Project | null;
  },
  async saveProject(p) {
    check(await supabase().from("projects").upsert(p));
    // Normalized copies of the generated design for reporting / other systems.
    check(await supabase().from("project_components").delete().eq("project_id", p.id));
    check(await supabase().from("engineering_calculations").delete().eq("project_id", p.id));
    if (p.design) {
      const comps = p.design.bom.map((l) => ({
        project_id: p.id, line_id: l.id, sku: l.sku, name: l.name, category: l.category, function: l.function,
        specification: l.specification, required_spec: l.required_spec, quantity: l.quantity, unit: l.unit,
        unit_price: l.unit_price, stock_status: l.stock_status, standard_reference: l.standard_reference,
        reasoning: l.reasoning, provenance: l.provenance,
      }));
      if (comps.length) check(await supabase().from("project_components").insert(comps));
      const calcs = p.design.calculation.results.map((r) => ({
        project_id: p.id, result_id: r.id, label: r.label, value: r.value, numeric_value: r.numeric ?? null, unit: r.unit ?? null,
        formula: r.formula ?? null, reason: r.reason, rule_id: r.rule_id, standards: r.standards, provenance: r.provenance, status: r.status,
      }));
      if (calcs.length) check(await supabase().from("engineering_calculations").insert(calcs));
    }
  },
  async recordReview(projectId, e) {
    check(await supabase().from("project_reviews").insert({ id: e.id, project_id: projectId, action: e.action, author: e.author, detail: e.detail ?? null, created_at: e.created_at }));
  },
  async listQuotes() {
    return check(await supabase().from("quotes").select("id, project_id, quote_number, total, status, approval_status, created_at").order("created_at", { ascending: false })) as Quote[];
  },
  async saveQuote(q, snapshot) {
    check(await supabase().from("quotes").upsert({ ...q, snapshot }));
  },
  /** Inserts missing catalogue rows only — stock levels already in the database are kept. */
  async seed() {
    const s = supabase();
    check(await s.from("products").upsert(SEED_PRODUCTS.map((p) => {
      const row: Partial<Product> = { ...p };
      delete row.stock_quantity; // stock lives in the inventory table
      return row;
    })));
    check(await s.from("inventory").upsert(SEED_PRODUCTS.map((p) => ({ sku: p.sku, stock_quantity: p.stock_quantity })), { onConflict: "sku", ignoreDuplicates: true }));
    check(await s.from("standards").upsert(STANDARDS.map((st) => ({ code: st.code, family: st.standard, title: st.title, topic: st.topic, version: st.version, used_for: st.used_for, implemented: st.implemented }))));
    return { products: SEED_PRODUCTS.length, standards: STANDARDS.length };
  },

  async getUserByEmail(email) {
    const r = check(await supabase().from("users").select("*").ilike("email", email.trim()).maybeSingle());
    return r ? userFromRow(r as Record<string, unknown>) : null;
  },
  async getUserById(id) {
    const r = check(await supabase().from("users").select("*").eq("id", id).maybeSingle());
    return r ? userFromRow(r as Record<string, unknown>) : null;
  },
  async createUser(u) {
    check(await supabase().from("users").insert({ id: u.id, name: u.name, email: u.email.toLowerCase(), role: u.role, password_hash: u.password_hash, active: u.active }));
  },
  async touchLogin(id) {
    check(await supabase().from("users").update({ last_login_at: new Date().toISOString() }).eq("id", id));
  },

  async approveProject(input) {
    const fresh = await this.getProject(input.project_id);
    if (!fresh) throw new RepoError("NOT_FOUND", "Project not found.");
    if (fresh.status === "APPROVED") throw new RepoError("ALREADY_APPROVED", "already approved", { approved_by: fresh.approved_by, approved_at: fresh.approved_at });
    input.validate?.(fresh);
    const { data, error } = await supabase().rpc("approve_project", {
      p_project_id: input.project_id, p_engineer_id: input.engineer.id, p_engineer_name: input.engineer.name, p_total: input.total_eur,
    });
    if (error) rpcError(error);
    const project = await this.getProject(input.project_id);
    if (!project) throw new RepoError("NOT_FOUND", "Project not found.");
    return { project, approval: approvalFromRow((data as { approval: Record<string, unknown> }).approval) };
  },
  async revokeApprovals(projectId, reason, now) {
    check(await supabase().from("project_approvals").update({ status: "REVOKED", revoked_at: now, revoked_reason: reason }).eq("project_id", projectId).eq("status", "APPROVED"));
  },
  async listApprovals(projectId) {
    const rows = check(await supabase().from("project_approvals").select("*").eq("project_id", projectId).order("approved_at", { ascending: false })) as Record<string, unknown>[];
    return rows.map(approvalFromRow);
  },

  async releaseProject(input) {
    const fresh = await this.getProject(input.project_id);
    if (!fresh) throw new RepoError("NOT_FOUND", "Project not found.");
    input.validate?.(fresh);
    const need = aggregate(input.requirements);
    if (!need.size) throw new RepoError("NO_MATERIALS", "This project has no stocked materials to release.");
    const { data, error } = await supabase().rpc("release_project", {
      p_project_id: input.project_id,
      p_requirements: [...need.entries()].map(([sku, n]) => ({ sku, quantity: n.quantity })),
      p_actor_id: input.actor.id,
      p_actor_name: input.actor.name,
    });
    if (error) rpcError(error);
    const project = await this.getProject(input.project_id);
    if (!project) throw new RepoError("NOT_FOUND", "Project not found.");
    const movements = ((data as { movements?: Record<string, unknown>[] } | null)?.movements ?? []).map(movementFromRow);
    return { project, movements };
  },
  async listMovements(opts = {}) {
    let q = supabase().from("inventory_movements").select("*").order("created_at", { ascending: false });
    if (opts.project_id) q = q.eq("project_id", opts.project_id);
    if (opts.limit) q = q.limit(opts.limit);
    return (check(await q) as Record<string, unknown>[]).map(movementFromRow);
  },
};

export function supabaseConfigured(): boolean {
  return Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function repo(): Repo {
  return supabaseConfigured() ? supabaseRepo : localRepo;
}
