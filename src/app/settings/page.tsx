import { Badge, Card, PageHeader } from "@/components/ui";
import { aiConfigured, aiModel, aiProvider } from "@/lib/ai/analyze";
import { CAD_ADAPTERS } from "@/lib/cad";
import { AUTOCAD_MCP_URL } from "@/lib/cad/autocad-mcp";
import { COMPANY, DEFAULT_ENGINEER } from "@/lib/config";
import { DEFAULT_COST_SETTINGS } from "@/lib/cost";
import { repo } from "@/lib/db";
import { DEFAULTS } from "@/lib/engineering/constants";
import { eur } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { SeedButton } from "./seed-button";

export const dynamic = "force-dynamic";

const PROVIDER_NAME: Record<string, string> = { groq: "Groq (GROQ_API_KEY)", gemini: "Google Gemini (GEMINI_API_KEY)", anthropic: "Anthropic Claude (AI_API_KEY)" };

function Row({ title, sub, badge }: { title: string; sub: string; badge: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div><div className="text-sm">{title}</div><div className="text-xs text-muted-foreground">{sub}</div></div>
      {badge}
    </li>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="label">{k}</dt><dd className="text-sm">{v}</dd></div>;
}

export default async function SettingsPage() {
  const { t } = await getT();
  const backend = repo().backend;
  const provider = aiProvider();
  return (
    <div>
      <PageHeader eyebrow={t("nav.settings")} title={t("page.settings.title")} subtitle={t("page.settings.sub")} />
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 xl:grid-cols-2">
        <Card title={t("page.settings.integrations")}>
          <ul className="divide-y divide-border">
            <Row
              title={t("page.settings.ai")}
              sub={`${provider ? PROVIDER_NAME[provider] : "GROQ_API_KEY · GEMINI_API_KEY · AI_API_KEY"}${aiModel() ? ` · ${aiModel()}` : ""}`}
              badge={aiConfigured() ? <Badge t="emerald">{t("page.settings.connected")}</Badge> : <Badge t="amber">{t("page.settings.ruleBased")}</Badge>}
            />
            <Row title={t("page.settings.db")} sub="SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" badge={backend === "supabase" ? <Badge t="emerald">Supabase</Badge> : <Badge t="amber">.data/db.json</Badge>} />
            {CAD_ADAPTERS.map((a) => (
              <Row
                key={a.id}
                title={a.name}
                sub={a.id === "autocad-mcp" ? `${a.description} · ${AUTOCAD_MCP_URL}` : a.description}
                badge={<Badge t={a.status === "available" ? "emerald" : "slate"}>{a.status === "available" ? t("page.settings.available") : "MCP · integrations/autocad-mcp"}</Badge>}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
            <span className="text-xs text-muted-foreground">{t("page.settings.reseedHint")}</span>
            <SeedButton />
          </div>
        </Card>
        <Card title={t("page.settings.company")}>
          <dl className="grid grid-cols-2 gap-4 p-5">
            <Kv k="Company" v={COMPANY.name} />
            <Kv k="Address" v={COMPANY.address} />
            <Kv k="Email" v={COMPANY.email} />
            <Kv k="Quote validity" v={`${COMPANY.quote_validity_days} d`} />
            <Kv k={t("common.engineer")} v={DEFAULT_ENGINEER} />
            <Kv k="Auth" v={<span className="text-muted-foreground">—</span>} />
          </dl>
        </Card>
        <Card title={t("page.settings.defaults")}>
          <dl className="grid grid-cols-2 gap-4 p-5">
            <Kv k="cos φ" v={DEFAULTS.power_factor} />
            <Kv k="η" v={DEFAULTS.efficiency} />
            <Kv k={t("field.frequency")} v={`${DEFAULTS.frequency_hz} Hz`} />
            <Kv k={t("field.ambient_temperature_c")} v={`${DEFAULTS.ambient_temperature_c} °C`} />
            <Kv k="ΔU max" v={`${DEFAULTS.max_voltage_drop_pct} %`} />
            <Kv k="Diversity" v={DEFAULTS.diversity_factor} />
          </dl>
        </Card>
        <Card title={t("page.settings.costDefaults")}>
          <dl className="grid grid-cols-2 gap-4 p-5">
            <Kv k={t("cost.laborRate")} v={`${eur(DEFAULT_COST_SETTINGS.labor_rate_eur_h)}/h`} />
            <Kv k={t("cost.engRate")} v={`${eur(DEFAULT_COST_SETTINGS.engineering_rate_eur_h)}/h`} />
            <Kv k={t("cost.marginPct")} v={`${DEFAULT_COST_SETTINGS.margin_pct}%`} />
          </dl>
        </Card>
      </div>
    </div>
  );
}
