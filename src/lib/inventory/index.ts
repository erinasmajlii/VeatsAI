import type { BomLine, Product, StockStatus } from "../types";

/**
 * Inventory module — compares required quantity vs available quantity.
 * Quantities are aggregated per SKU across BOM lines (the same item may serve several functions).
 */

export const STOCK_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
  UNAVAILABLE: "Component unavailable",
};

export function stockStatusFor(required: number, available: number, minLevel: number): StockStatus {
  if (available <= 0 || available < required) return "OUT_OF_STOCK";
  if (available - required < minLevel) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Stock status of a product on its own (inventory page). */
export function productStockStatus(p: Product): StockStatus {
  if (p.stock_quantity <= 0) return "OUT_OF_STOCK";
  if (p.stock_quantity <= p.min_stock_level) return "LOW_STOCK";
  return "IN_STOCK";
}

export function applyInventoryCheck(lines: BomLine[]): BomLine[] {
  const requiredBySku = new Map<string, number>();
  for (const l of lines) if (l.sku) requiredBySku.set(l.sku, (requiredBySku.get(l.sku) ?? 0) + l.quantity);
  return lines.map((l) => ({
    ...l,
    stock_status: l.sku ? stockStatusFor(requiredBySku.get(l.sku) ?? l.quantity, l.stock, l.min_stock_level) : "UNAVAILABLE",
  }));
}

export function inventorySummary(lines: BomLine[]) {
  const counts: Record<StockStatus, number> = { IN_STOCK: 0, LOW_STOCK: 0, OUT_OF_STOCK: 0, UNAVAILABLE: 0 };
  for (const l of lines) counts[l.stock_status]++;
  return counts;
}
