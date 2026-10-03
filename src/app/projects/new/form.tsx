"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StandardsFamilyInfo } from "@/lib/standards";
import { Badge } from "@/components/ui";

export function NewProjectForm({
  demoRequest,
  prefillDemo,
  aiConfigured,
  families,
}: {
  demoRequest: string;
  prefillDemo: boolean;
  aiConfigured: boolean;
  families: StandardsFamilyInfo[];
}) {
  const router = useRouter();
  const [request, setRequest] = useState(prefillDemo ? demoRequest : "");
  const [client, setClient] = useState(prefillDemo ? "Demo Manufacturing Sh.p.k." : "");
  const [standard, setStandard] = useState("IEC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string; fallback?: boolean } | null>(null);

  async function submit(mode: "auto" | "rule_based" = "auto") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, client_name: client || undefined, standard, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? "AI analysis failed. Please retry.", detail: data.detail ?? data.issues?.join("; "), fallback: data.fallback_available });
        return;
      }
      router.push(`/projects/${data.id}`);
    } catch {
      setError({ message: "AI analysis failed. Please retry.", detail: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-5 p-6">
      <div>
        <label className="label" htmlFor="req">Describe your electrical project</label>
        <textarea
          id="req"
          className="input min-h-36 font-mono text-[13px]"
          placeholder='e.g. "I need a control panel for 3 motors, each 15 kW, running at 400V."'
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <button type="button" className="font-medium text-emerald-700 hover:underline" onClick={() => setRequest(demoRequest)}>
            Use demo request
          </button>
          <span>·</span>
          {aiConfigured ? <Badge t="violet">AI request understanding enabled</Badge> : <Badge t="amber">AI not configured — rule-based parser will be used</Badge>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="client">Client</label>
          <input id="client" className="input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client company" />
        </div>
        <div>
          <label className="label" htmlFor="std">Engineering standard</label>
          <select id="std" className="input" value={standard} onChange={(e) => setStandard(e.target.value)}>
            {families.map((f) => (
              <option key={f.family} value={f.family} disabled={f.status !== "implemented"}>
                {f.family} {f.status === "implemented" ? "— implemented (MVP rules)" : "— coming soon (not implemented)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">{error.message}</div>
          {error.detail && <div className="mt-1 text-xs">{error.detail}</div>}
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost" onClick={() => submit("auto")} disabled={busy}>Retry</button>
            {error.fallback && (
              <button className="btn-ghost" onClick={() => submit("rule_based")} disabled={busy}>Use rule-based parser instead</button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
        {busy && <span className="text-xs text-slate-500">{aiConfigured ? "AI is analysing the request…" : "Parsing request…"}</span>}
        <button className="btn-primary" disabled={busy || request.trim().length < 5} onClick={() => submit("auto")}>
          {busy ? "Analysing…" : "Analyse Request →"}
        </button>
      </div>
    </div>
  );
}
