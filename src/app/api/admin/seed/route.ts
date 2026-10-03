import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { repo } from "@/lib/db";
import { SEED_PRODUCTS } from "@/lib/inventory/catalog";
import { STANDARDS } from "@/lib/standards";

const q = (v: unknown) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

/** GET /api/admin/seed — seed SQL generated from the catalog (used to produce supabase/seed.sql). */
export function GET() {
  const lines = [
    "-- VeatsAI seed data (generated from data/products.client.json + demo supplement)",
    "insert into users (name, email, role) values ('Demo Engineer', 'engineer@veats.example', 'engineer') on conflict (email) do nothing;",
    ...STANDARDS.map(
      (s) =>
        `insert into standards (code, family, title, topic, version, used_for, implemented) values (${q(s.code)}, ${q(s.standard)}, ${q(s.title)}, ${q(s.topic)}, ${q(s.version)}, ${q(JSON.stringify(s.used_for))}::jsonb, ${s.implemented}) on conflict (code) do update set title = excluded.title, topic = excluded.topic, used_for = excluded.used_for;`,
    ),
    ...SEED_PRODUCTS.map(
      (p) =>
        `insert into products (sku, name, category, unit, purchase_price_eur, selling_price_eur, min_stock_level, attributes, source) values (${q(p.sku)}, ${q(p.name)}, ${q(p.category)}, ${q(p.unit)}, ${p.purchase_price_eur}, ${p.selling_price_eur}, ${p.min_stock_level}, ${q(JSON.stringify(p.attributes))}::jsonb, ${q(p.source)}) on conflict (sku) do update set name = excluded.name, purchase_price_eur = excluded.purchase_price_eur, selling_price_eur = excluded.selling_price_eur, min_stock_level = excluded.min_stock_level, attributes = excluded.attributes;`,
    ),
    ...SEED_PRODUCTS.map(
      (p) => `insert into inventory (sku, stock_quantity) values (${q(p.sku)}, ${p.stock_quantity}) on conflict (sku) do update set stock_quantity = excluded.stock_quantity, updated_at = now();`,
    ),
  ];
  return new NextResponse(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** POST /api/admin/seed — (re)seed products, inventory and standards in the active database. */
export async function POST() {
  return handle(() => repo().seed());
}
