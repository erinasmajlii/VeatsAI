import Link from "next/link";
import { Badge, Card, PageHeader, StockBadge } from "@/components/ui";
import { specOf } from "@/lib/bom";
import { repo } from "@/lib/db";
import { eur, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { productStockStatus } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { t, lang } = await getT();
  const db = repo();
  const [products, movements, projects] = await Promise.all([db.listProducts(), db.listMovements({ limit: 25 }), db.listProjects()]);
  const projectTitle = new Map(projects.map((p) => [p.id, p.title]));
  const nameOf = new Map(products.map((p) => [p.sku, p]));
  const categories = Array.from(new Set(products.map((p) => p.category)));
  const value = products.reduce((s, p) => s + p.stock_quantity * p.purchase_price_eur, 0);
  return (
    <div>
      <PageHeader
        eyebrow={t("inv.eyebrow")}
        title={t("page.inventory.title")}
        subtitle={t("page.inventory.sub", { n: products.length, v: eur(value), src: db.backend === "supabase" ? "Supabase" : t("common.demoData") })}
      />
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-6 sm:px-8">
        <Card title={t("inv.movements")}>
          {movements.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("inv.mv.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("inv.mv.when")}</th>
                    <th>{t("inv.mv.project")}</th>
                    <th>{t("inv.mv.item")}</th>
                    <th className="text-right">{t("inv.mv.change")}</th>
                    <th className="text-right">{t("inv.mv.balance")}</th>
                    <th>{t("common.by")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(m.created_at, lang)}</td>
                      <td><Link href={`/projects/${m.project_id}`} className="hover:underline">{projectTitle.get(m.project_id) ?? m.project_id}</Link></td>
                      <td><span className="font-mono text-xs">{m.sku}</span> <span className="text-xs text-muted-foreground">{nameOf.get(m.sku)?.name}</span></td>
                      <td className="text-right font-mono tabular-nums text-danger">{m.quantity_change}</td>
                      <td className="text-right font-mono tabular-nums">{m.stock_before} → {m.stock_after}</td>
                      <td className="text-xs">{m.actor_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
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
