import { Badge, Card, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { STANDARD_FAMILIES, STANDARDS } from "@/lib/standards";

export const dynamic = "force-dynamic";

/**
 * Which engineering standards the platform currently uses.
 * The list comes from the standards module the calculations reference (src/lib/standards) — no duplicate data.
 */
export default async function StandardsPage() {
  const { t } = await getT();
  const unavailable = STANDARD_FAMILIES.filter((f) => f.status !== "implemented");
  return (
    <div>
      <PageHeader eyebrow={t("nav.standards")} title={t("page.standards.title")} subtitle={t("page.standards.sub")} />
      <div className="mx-auto max-w-5xl space-y-4 px-5 py-6 sm:px-8">
        <Card>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-44">{t("page.standards.col.standard")}</th>
                  <th>{t("page.standards.col.description")}</th>
                  <th className="w-36">{t("page.standards.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {STANDARDS.map((s) => (
                  <tr key={s.code}>
                    <td className="whitespace-nowrap font-mono text-[13px] font-medium">{s.code}</td>
                    <td>
                      <div>{s.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{s.topic}</div>
                    </td>
                    <td>{s.implemented ? <Badge t="emerald">{t("page.standards.active")}</Badge> : <Badge t="slate">{t("page.standards.unavailable")}</Badge>}</td>
                  </tr>
                ))}
                {unavailable.map((f) => (
                  <tr key={f.family}>
                    <td className="whitespace-nowrap font-mono text-[13px] font-medium">{f.family}</td>
                    <td>
                      <div>{f.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{t("page.standards.nec")}</div>
                    </td>
                    <td><Badge t="slate">{t("page.standards.unavailable")}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("page.standards.disclaimer")}</p>
      </div>
    </div>
  );
}
