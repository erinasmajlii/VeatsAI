import { aiConfigured, aiModel, aiProvider } from "@/lib/ai/analyze";
import { CAD_ADAPTERS } from "@/lib/cad";
import { COMPANY, DEFAULT_ENGINEER } from "@/lib/config";
import { DEFAULT_COST_SETTINGS } from "@/lib/cost";
import { repo } from "@/lib/db";
import { DEFAULTS } from "@/lib/engineering/constants";
import { Badge, Card, PageHeader, eur } from "@/components/ui";
import { SeedButton } from "./seed-button";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const backend = repo().backend;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Integrations, company data and engine defaults" />
      <div className="grid gap-6 p-8 xl:grid-cols-2">
        <Card title="Integrations">
          <ul className="divide-y divide-slate-100 text-sm">
            <li className="flex items-center justify-between px-5 py-3">
              <div><div className="font-medium">AI request understanding</div><div className="text-xs text-slate-500">Server-side only · {aiProvider() === "groq" ? "Groq (GROQ_API_KEY)" : aiProvider() === "gemini" ? "Google Gemini (GEMINI_API_KEY)" : aiProvider() === "anthropic" ? "Anthropic Claude (AI_API_KEY)" : "GROQ_API_KEY, GEMINI_API_KEY or AI_API_KEY"}{aiModel() ? ` · model ${aiModel()}` : ""}</div></div>
              {aiConfigured() ? <Badge t="emerald">Connected</Badge> : <Badge t="amber">Not configured — rule-based parser</Badge>}
            </li>
            <li className="flex items-center justify-between px-5 py-3">
              <div><div className="font-medium">Database</div><div className="text-xs text-slate-500">SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY</div></div>
              {backend === "supabase" ? <Badge t="emerald">Supabase</Badge> : <Badge t="amber">Local file (.data/db.json)</Badge>}
            </li>
            {CAD_ADAPTERS.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-5 py-3">
                <div><div className="font-medium">{a.name}</div><div className="text-xs text-slate-500">{a.description}</div></div>
                {a.status === "available" ? <Badge t="emerald">Available</Badge> : <Badge t="slate">Not configured</Badge>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <span className="text-xs text-slate-500">Reset product catalog and stock levels to the seed dataset.</span>
            <SeedButton />
          </div>
        </Card>
        <Card title="Company & users">
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><dt className="label">Company</dt><dd>{COMPANY.name}</dd></div>
            <div><dt className="label">Address</dt><dd>{COMPANY.address}</dd></div>
            <div><dt className="label">Quote email</dt><dd>{COMPANY.email}</dd></div>
            <div><dt className="label">Quote validity</dt><dd>{COMPANY.quote_validity_days} days</dd></div>
            <div><dt className="label">Engineer (demo user)</dt><dd>{DEFAULT_ENGINEER}</dd></div>
            <div><dt className="label">Authentication</dt><dd className="text-slate-500">Not in MVP</dd></div>
          </dl>
        </Card>
        <Card title="Engine defaults (shown as “Assumed value” in projects)">
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><dt className="label">Power factor</dt><dd>{DEFAULTS.power_factor}</dd></div>
            <div><dt className="label">Efficiency</dt><dd>{DEFAULTS.efficiency}</dd></div>
            <div><dt className="label">Frequency</dt><dd>{DEFAULTS.frequency_hz} Hz</dd></div>
            <div><dt className="label">Ambient reference</dt><dd>{DEFAULTS.ambient_temperature_c} °C</dd></div>
            <div><dt className="label">Max voltage drop</dt><dd>{DEFAULTS.max_voltage_drop_pct} %</dd></div>
            <div><dt className="label">Diversity factor</dt><dd>{DEFAULTS.diversity_factor}</dd></div>
          </dl>
        </Card>
        <Card title="Cost defaults">
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><dt className="label">Labor rate</dt><dd>{eur(DEFAULT_COST_SETTINGS.labor_rate_eur_h)}/h</dd></div>
            <div><dt className="label">Engineering rate</dt><dd>{eur(DEFAULT_COST_SETTINGS.engineering_rate_eur_h)}/h</dd></div>
            <div><dt className="label">Default margin</dt><dd>{DEFAULT_COST_SETTINGS.margin_pct}%</dd></div>
            <div><dt className="label">Hours</dt><dd className="text-slate-500">Estimated per project; engineer can override</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
