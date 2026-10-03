import type { MaterialRequirement, Product, Project, UnstockedMaterial } from "../types";

/**
 * Which stocked materials a project consumes. This is the single source of truth for the release
 * preview AND the release itself, so what the engineer sees is exactly what is deducted.
 *
 * Sources: the engineering design BOM and the electrical-plan BOM. Lines without a catalogue SKU are not
 * stocked, so they are listed as "not deducted" (to be purchased) instead of being silently ignored.
 */
export function projectMaterials(p: Project): { requirements: MaterialRequirement[]; unstocked: UnstockedMaterial[] } {
  const requirements: MaterialRequirement[] = [];
  const unstocked: UnstockedMaterial[] = [];
  for (const l of p.design?.bom ?? []) {
    if (!(l.quantity > 0)) continue;
    if (l.sku) requirements.push({ sku: l.sku, name: l.name, quantity: l.quantity, unit: l.unit, source: "design" });
    else unstocked.push({ description: `${l.function} (${l.required_spec})`, quantity: l.quantity, unit: l.unit });
  }
  for (const l of p.plan?.electrical?.bom ?? []) {
    if (!(l.quantity > 0)) continue;
    if (l.sku) requirements.push({ sku: l.sku, name: l.description, quantity: l.quantity, unit: l.unit, source: "plan" });
    else unstocked.push({ description: l.description, quantity: l.quantity, unit: l.unit });
  }
  return { requirements, unstocked };
}

export interface ReleasePreviewLine {
  sku: string;
  name: string;
  unit: string;
  required: number;
  stock: number | null;
  after: number | null;
  ok: boolean;
}

/** Aggregates per SKU and compares with current stock (read-only — never changes anything). */
export function releasePreview(p: Project, products: Product[]) {
  const { requirements, unstocked } = projectMaterials(p);
  const bySku = new Map(products.map((x) => [x.sku, x]));
  const agg = new Map<string, { name: string; unit: string; required: number }>();
  for (const r of requirements) {
    const cur = agg.get(r.sku);
    if (cur) cur.required = Math.round((cur.required + r.quantity) * 1000) / 1000;
    else agg.set(r.sku, { name: r.name, unit: r.unit, required: r.quantity });
  }
  const lines: ReleasePreviewLine[] = [...agg.entries()].map(([sku, a]) => {
    const prod = bySku.get(sku);
    const stock = prod ? prod.stock_quantity : null;
    return { sku, name: prod?.name ?? a.name, unit: prod?.unit ?? a.unit, required: a.required, stock, after: stock === null ? null : Math.round((stock - a.required) * 1000) / 1000, ok: stock !== null && stock >= a.required };
  }).sort((a, b) => a.sku.localeCompare(b.sku));
  return { lines, unstocked, can_release: lines.length > 0 && lines.every((l) => l.ok) };
}
