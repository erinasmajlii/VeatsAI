import { Badge, Card, PageHeader, StockBadge } from "@/components/ui";
import { specOf } from "@/lib/bom";
import { repo } from "@/lib/db";
import { eur } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { productStockStatus } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { t } = await getT();
  const db = repo();
  const products = await db.listProducts();
  const categories = Array.from(new Set(products.map((p) => p.category)));
  const value = products.reduce((s, p) => s + p.stock_quantity * p.purchase_price_eur, 0);
  return (
    <div>
      <PageHeader
        eyebrow={t("inv.eyebrow")}
        title={t("page.inventory.title")}
        subtitle={t("page.inventory.sub", { n: products.length, v: eur(value), src: db.backend === "supabase" ? "Supabase" : t("common.demoData") })}
      />
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {categories.map((cat) => (
          <Card key={cat} title={cat}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>{t("page.inventory.col.product")}</th>
                    <th>{t("page.inventory.col.spec")}</th>
                    <th className="text-right">{t("page.inventory.col.purchase")}</th>
                    <th className="text-right">{t("page.inventory.col.selling")}</th>
                    <th className="text-right">{t("page.inventory.col.stock")}</th>
                    <th className="text-right">{t("page.inventory.col.min")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {products.filter((p) => p.category === cat).map((p) => (
                    <tr key={p.sku}>
                      <td className="whitespace-nowrap font-mono text-xs">{p.sku}</td>
                      <td>
                        <div className="font-medium">{p.name}</div>
                        {p.source === "demo_supplement" && <Badge t="violet">{t("common.demoData")}</Badge>}
                      </td>
                      <td className="text-xs text-muted-foreground">{specOf(p)}</td>
                      <td className="text-right font-mono tabular-nums">{eur(p.purchase_price_eur)}</td>
                      <td className="text-right font-mono tabular-nums">{eur(p.selling_price_eur)}</td>
                      <td className="text-right font-mono tabular-nums">{p.stock_quantity} <span className="text-xs text-muted-foreground">{p.unit}</span></td>
                      <td className="text-right font-mono tabular-nums text-muted-foreground">{p.min_stock_level}</td>
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
