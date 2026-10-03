import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import { SEED_PRODUCTS } from "../inventory/catalog";
import { STANDARDS } from "../standards";
import type { Product, Project, Quote, ReviewEvent } from "../types";

/**
 * Data access layer.
 *
 * - Supabase (Postgres) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (server-side only).
 * - Otherwise a local JSON file (.data/db.json) so the demo runs with zero setup.
 *
 * Both backends seed the product catalog automatically on first access.
 */

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
}

// ------------------------------------------------------------------ local

interface LocalDb {
  products: Product[];
  projects: Project[];
  quotes: Quote[];
  reviews: (ReviewEvent & { project_id: string })[];
}

const LOCAL_FILE = path.join(process.cwd(), ".data", "db.json");

async function readLocal(): Promise<LocalDb> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_FILE, "utf8")) as LocalDb;
  } catch {
    const fresh: LocalDb = { products: SEED_PRODUCTS, projects: [], quotes: [], reviews: [] };
    await writeLocal(fresh);
    return fresh;
  }
}

async function writeLocal(db: LocalDb) {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  const tmp = `${LOCAL_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, LOCAL_FILE);
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
    const db = await readLocal();
    const i = db.projects.findIndex((x) => x.id === p.id);
    if (i >= 0) db.projects[i] = p;
    else db.projects.push(p);
    await writeLocal(db);
  },
  async recordReview(projectId, e) {
    const db = await readLocal();
    db.reviews.push({ ...e, project_id: projectId });
    await writeLocal(db);
  },
  async listQuotes() {
    return (await readLocal()).quotes.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async saveQuote(q) {
    const db = await readLocal();
    const i = db.quotes.findIndex((x) => x.id === q.id);
    if (i >= 0) db.quotes[i] = q;
    else db.quotes.push(q);
    await writeLocal(db);
  },
  async seed() {
    const db = await readLocal();
    db.products = SEED_PRODUCTS;
    await writeLocal(db);
    return { products: SEED_PRODUCTS.length, standards: STANDARDS.length };
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

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

type ProductRow = Omit<Product, "stock_quantity"> & { inventory: { stock_quantity: number } | { stock_quantity: number }[] | null };

let seeded = false;

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
  async seed() {
    const s = supabase();
    check(await s.from("products").upsert(SEED_PRODUCTS.map((p) => {
      const row: Partial<Product> = { ...p };
      delete row.stock_quantity; // stock lives in the inventory table
      return row;
    })));
    check(await s.from("inventory").upsert(SEED_PRODUCTS.map((p) => ({ sku: p.sku, stock_quantity: p.stock_quantity }))));
    check(await s.from("standards").upsert(STANDARDS.map((st) => ({ code: st.code, family: st.standard, title: st.title, topic: st.topic, version: st.version, used_for: st.used_for, implemented: st.implemented }))));
    return { products: SEED_PRODUCTS.length, standards: STANDARDS.length };
  },
};

export function supabaseConfigured(): boolean {
  return Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function repo(): Repo {
  return supabaseConfigured() ? supabaseRepo : localRepo;
}
