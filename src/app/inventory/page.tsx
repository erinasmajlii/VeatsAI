import { repo } from "@/lib/db";
import { productStockStatus } from "@/lib/inventory";
import { specOf } from "@/lib/bom";
import { Badge, Card, PageHeader, StockBadge, eur } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = repo();
  const products = await db.listProducts();
  const categories = Array.from(new Set(products.map((p) => p.category)));
  const value = products.reduce((s, p) => s + p.stock_quantity * p.purchase_price_eur, 0);
  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle={`${products.length} products · stock value ${eur(value)} (purchase) · source: ${db.backend === "supabase" ? "Supabase" : "local demo database"}`}
      />
      <div className="space-y-6 p-8">
        {categories.map((cat) => (
          <Card key={cat} title={cat}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>SKU</th><th>Product</th><th>Specification</th><th className="text-right">Purchase</th><th className="text-right">Selling</th><th className="text-right">Stock</th><th className="text-right">Min</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {products.filter((p) => p.category === cat).map((p) => (
                    <tr key={p.sku}>
                      <td className="whitespace-nowrap font-mono text-xs">{p.sku}</td>
                      <td>
                        <div className="font-medium">{p.name}</div>
                        {p.source === "demo_supplement" && <Badge t="violet">Demo data</Badge>}
                      </td>
                      <td className="text-xs text-slate-600">{specOf(p)}</td>
                      <td className="text-right tabular-nums">{eur(p.purchase_price_eur)}</td>
                      <td className="text-right tabular-nums">{eur(p.selling_price_eur)}</td>
                      <td className="text-right tabular-nums">{p.stock_quantity} <span className="text-xs text-slate-500">{p.unit}</span></td>
                      <td className="text-right tabular-nums text-slate-500">{p.min_stock_level}</td>
                      <td><StockBadge s={productStockStatus(p)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
