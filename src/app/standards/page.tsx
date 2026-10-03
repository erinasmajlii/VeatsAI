import { Badge, Card, PageHeader, SeverityBadge } from "@/components/ui";
import { AMBIENT_CORRECTION_PVC, AMPACITY_TABLE_A, CONDUCTOR_SIZES_MM2, ENVIRONMENT_MIN_IP, STARTING_METHOD_LABEL, STARTING_MULTIPLIER } from "@/lib/engineering/constants";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { RULES, STANDARD_FAMILIES, STANDARDS } from "@/lib/standards";
import type { InstallationMethod } from "@/lib/types";

const INSTALLS: InstallationMethod[] = ["conduit_on_wall", "cable_tray", "buried", "in_free_air"];

export default async function StandardsPage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader eyebrow={t("nav.standards")} title={t("page.standards.title")} subtitle={t("page.standards.sub")} />
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="rounded-md border border-cyan-500/25 bg-cyan-500/5 px-4 py-3 text-xs text-cyan-900 dark:text-cyan-200">{t("page.standards.disclaimer")}</div>

        <Card title={t("page.standards.families")}>
          <ul className="divide-y divide-border">
            {STANDARD_FAMILIES.map((f) => (
              <li key={f.family} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div><div className="font-medium">{f.label}</div><div className="text-xs text-muted-foreground">{f.note}</div></div>
                {f.status === "implemented" ? <Badge t="emerald">{t("page.standards.implemented")}</Badge> : <Badge t="slate">{t("page.standards.soon")}</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("std.title")}>
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {STANDARDS.map((s) => (
              <div key={s.code} className="rounded-md border border-border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm">{s.code}</div>
                  <Badge t="cyan">{s.standard}</Badge>
                </div>
                <div className="mt-1 text-sm">{s.title}</div>
                <div className="mt-2 text-xs text-muted-foreground">{t("page.standards.usedFor")}: {s.used_for.join(", ")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t("std.edition")}: {s.version === "configurable" ? t("std.notConfigured") : s.version}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t("page.standards.rules", { n: RULES.length })}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("page.standards.col.rule")}</th><th>{t("bom.col.standard")}</th><th>{t("page.standards.col.description")}</th>
                  <th>{t("page.standards.col.inputs")}</th><th>{t("page.standards.col.impl")}</th><th>{t("page.standards.col.severity")}</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id}>
                    <td><div className="font-medium">{r.name}</div><div className="font-mono text-[11px] text-muted-foreground">{r.id}</div></td>
                    <td className="whitespace-nowrap text-xs">{r.standard.join(" / ")}</td>
                    <td className="text-xs">{r.description}</td>
                    <td className="font-mono text-[11px] text-muted-foreground">{r.inputs.join(", ")}</td>
                    <td className="text-xs text-muted-foreground">{r.implementation}</td>
                    <td><SeverityBadge s={r.severity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card title={t("page.standards.ampacity")}>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>mm²</th>{INSTALLS.map((k) => <th key={k}>{t(`inst.${k}` as MessageKey)}</th>)}</tr></thead>
                <tbody>
                  {CONDUCTOR_SIZES_MM2.map((s) => (
                    <tr key={s}><td className="font-mono">{s}</td>{INSTALLS.map((k) => <td key={k} className="font-mono tabular-nums">{AMPACITY_TABLE_A[k][s]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[11px] text-muted-foreground">{t("page.standards.ampacityNote")}</p>
          </Card>
          <div className="space-y-6">
            <Card title={t("page.standards.ip")}>
              <table className="tbl"><tbody>{Object.entries(ENVIRONMENT_MIN_IP).map(([k, v]) => <tr key={k}><td>{t(`env.${k}` as MessageKey)}</td><td className="font-mono">{v}</td></tr>)}</tbody></table>
            </Card>
            <Card title={t("page.standards.start")}>
              <table className="tbl"><tbody>{Object.entries(STARTING_MULTIPLIER).map(([k, v]) => <tr key={k}><td>{STARTING_METHOD_LABEL[k as keyof typeof STARTING_METHOD_LABEL]}</td><td className="font-mono">{v} × FLC</td></tr>)}</tbody></table>
            </Card>
            <Card title={t("page.standards.ambient")}>
              <div className="flex flex-wrap gap-2 p-4 font-mono text-xs">{AMBIENT_CORRECTION_PVC.map(([temp, f]) => <span key={temp} className="rounded bg-muted px-2 py-1">{temp} °C: {f}</span>)}</div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
