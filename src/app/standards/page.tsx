import { AMPACITY_TABLE_A, AMBIENT_CORRECTION_PVC, CONDUCTOR_SIZES_MM2, ENVIRONMENT_LABEL, ENVIRONMENT_MIN_IP, INSTALLATION_LABEL, STARTING_METHOD_LABEL, STARTING_MULTIPLIER } from "@/lib/engineering/constants";
import { RULES, STANDARD_FAMILIES, STANDARDS } from "@/lib/standards";
import { Badge, Card, PageHeader, SeverityBadge } from "@/components/ui";
import type { InstallationMethod } from "@/lib/types";

export default function StandardsPage() {
  return (
    <div>
      <PageHeader title="Standards Engine" subtitle="Standards and engineering rules referenced by the Engineering Engine. Rules are data, versioned separately from the UI." />
      <div className="space-y-6 p-8">
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-900">
          VeatsAI references these standards conceptually. It does not reproduce their text, does not implement every requirement and does not certify compliance.
          Editions are shown only when explicitly configured.
        </div>

        <Card title="Standard families">
          <ul className="divide-y divide-slate-100">
            {STANDARD_FAMILIES.map((f) => (
              <li key={f.family} className="flex items-center justify-between px-5 py-3 text-sm">
                <div><strong>{f.label}</strong><div className="text-xs text-slate-500">{f.note}</div></div>
                {f.status === "implemented" ? <Badge t="emerald">Implemented (MVP)</Badge> : <Badge t="slate">Coming soon — not implemented</Badge>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Standards used">
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {STANDARDS.map((s) => (
              <div key={s.code} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{s.code}</div>
                  <Badge t="cyan">{s.standard}</Badge>
                </div>
                <div className="text-sm text-slate-700">{s.title}</div>
                <div className="mt-2 text-xs text-slate-500">Used for: {s.used_for.join(", ")}</div>
                <div className="mt-1 text-xs text-slate-500">Edition: {s.version === "configurable" ? "not configured" : s.version}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Engineering rules (${RULES.length})`}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Rule</th><th>Standard</th><th>Description</th><th>Inputs</th><th>MVP implementation</th><th>Severity</th></tr></thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id}>
                    <td><div className="font-medium">{r.name}</div><div className="font-mono text-[11px] text-slate-500">{r.id}</div></td>
                    <td className="whitespace-nowrap text-xs">{r.standard.join(" / ")}</td>
                    <td className="text-xs">{r.description}</td>
                    <td className="font-mono text-[11px] text-slate-600">{r.inputs.join(", ")}</td>
                    <td className="text-xs text-slate-600">{r.implementation}</td>
                    <td><SeverityBadge s={r.severity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Reference data — indicative cable ampacity (A), Cu/PVC, 3 loaded conductors, 30 °C">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>mm²</th>{(Object.keys(INSTALLATION_LABEL) as InstallationMethod[]).map((k) => <th key={k}>{INSTALLATION_LABEL[k]}</th>)}</tr></thead>
                <tbody>
                  {CONDUCTOR_SIZES_MM2.map((s) => (
                    <tr key={s}><td className="font-mono">{s}</td>{(Object.keys(INSTALLATION_LABEL) as InstallationMethod[]).map((k) => <td key={k} className="tabular-nums">{AMPACITY_TABLE_A[k][s]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[11px] text-slate-500">Indicative values for preliminary sizing. Verify against IEC 60364-5-52 tables and manufacturer data for the actual installation.</p>
          </Card>
          <div className="space-y-6">
            <Card title="Environment → minimum IP (IEC 60529, company rule)">
              <table className="tbl"><tbody>{Object.entries(ENVIRONMENT_MIN_IP).map(([k, v]) => <tr key={k}><td>{ENVIRONMENT_LABEL[k as keyof typeof ENVIRONMENT_LABEL]}</td><td className="font-mono">{v}</td></tr>)}</tbody></table>
            </Card>
            <Card title="Starting current multipliers (typical)">
              <table className="tbl"><tbody>{Object.entries(STARTING_MULTIPLIER).map(([k, v]) => <tr key={k}><td>{STARTING_METHOD_LABEL[k as keyof typeof STARTING_METHOD_LABEL]}</td><td className="font-mono">{v} × FLC</td></tr>)}</tbody></table>
            </Card>
            <Card title="Ambient correction (PVC, ref. 30 °C)">
              <div className="flex flex-wrap gap-2 p-4 font-mono text-xs">{AMBIENT_CORRECTION_PVC.map(([t, f]) => <span key={t} className="rounded bg-slate-100 px-2 py-1">{t} °C: {f}</span>)}</div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
