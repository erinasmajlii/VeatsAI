"use client";

import { useMemo, useRef, useState } from "react";
import { CRITICAL_FIELDS } from "@/lib/engineering/inputs";
import { eur } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { productStockStatus } from "@/lib/inventory";
import type { StandardDefinition, StandardRule } from "@/lib/standards";
import type { Product, Project } from "@/lib/types";
import { useT } from "@/components/i18n";
import { Spinner, StatusBadge } from "@/components/ui";
import { Workspace } from "../projects/[id]/workspace";

type Msg = { role: "user" | "agent"; text: string; error?: boolean; retry?: { request: string; client: string } };

export function EngineerPanel({
  projects: initialProjects,
  products,
  initialProject,
  standards,
  rules,
  ai,
}: {
  projects: Project[];
  products: Product[];
  initialProject: Project | null;
  standards: StandardDefinition[];
  rules: StandardRule[];
  ai: { provider: string | null; model: string | null };
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [current, setCurrent] = useState<Project | null>(initialProject);

  function select(p: Project | null) {
    setCurrent(p);
    window.history.replaceState(null, "", p ? `/dashboard?p=${p.id}` : "/dashboard");
  }
  function upsert(p: Project) {
    setProjects((list) => [p, ...list.filter((x) => x.id !== p.id)]);
  }
  async function open(id: string) {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) select(await res.json());
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]">
      <RequestPortal ai={ai} projects={projects} currentId={current?.id ?? null} onCreated={(p) => { upsert(p); select(p); }} onOpen={open} />
      <section className="min-h-0 overflow-y-auto border-border lg:border-r">
        {current ? (
          <Workspace
            key={current.id}
            initial={current}
            products={products}
            standards={standards}
            rules={rules}
            embedded
            onChange={(p) => { upsert(p); setCurrent(p); }}
          />
        ) : (
          <EmptyProject />
        )}
      </section>
      <InventoryPanel products={products} project={current} />
    </div>
  );
}

// ------------------------------------------------------------------ left: request portal

function RequestPortal({
  ai,
  projects,
  currentId,
  onCreated,
  onOpen,
}: {
  ai: { provider: string | null; model: string | null };
  projects: Project[];
  currentId: string | null;
  onCreated: (p: Project) => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function send(request = text, clientName = client, mode: "auto" | "rule_based" = "auto") {
    if (request.trim().length < 5 || busy) return;
    setBusy(true);
    if (mode === "auto") setMessages((m) => [...m, { role: "user", text: request }]);
    setText("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, client_name: clientName || undefined, standard: "IEC", mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: "agent", error: true, text: [data.error, data.detail].filter(Boolean).join(" — "), retry: data.fallback_available ? { request, client: clientName } : undefined }]);
        return;
      }
      const p = data as Project;
      const a = p.analysis!;
      const summary = [
        a.motors.map((m) => `${m.quantity} × ${m.power_kw} kW`).join(" + "),
        a.voltage ? `${a.voltage} V` : null,
        a.starting_method,
        a.cable_length_m ? `${a.cable_length_m} m` : null,
      ].filter(Boolean).join(", ");
      const critical = a.missing_information.filter((f) => (CRITICAL_FIELDS as readonly string[]).includes(f));
      const reply = [
        t("portal.reply.understood", { summary: summary || "—" }),
        critical.length ? t("portal.reply.missing", { fields: critical.map((f) => t(`field.${f}` as MessageKey)).join(", ") }) : t("portal.reply.complete"),
        a.source === "ai" ? t("portal.reply.source.ai", { model: a.model ?? "" }) : t("portal.reply.source.rule"),
      ].join(" ");
      setMessages((m) => [...m, { role: "agent", text: reply }]);
      setClient("");
      onCreated(p);
    } catch {
      setMessages((m) => [...m, { role: "agent", error: true, text: t("common.requestFailed") }]);
    } finally {
      setBusy(false);
    }
  }

  const examples = [t("portal.ex.1"), t("portal.ex.2"), t("portal.ex.3")];

  return (
    <aside className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{t("portal.eyebrow")}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={ai.model ?? undefined}>
            <span className={`h-1.5 w-1.5 rounded-full ${ai.provider ? "bg-emerald-500" : "bg-amber-500"}`} />
            {busy ? t("common.working") : t("portal.ready")}
          </span>
        </div>
        <div className="mt-1 text-sm">{t("portal.title")}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{ai.provider ? t("portal.aiOn", { provider: `${ai.provider} · ${ai.model}` }) : t("portal.aiOff")}</div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
        <p className="leading-relaxed">{t("portal.greeting")}</p>

        {messages.length === 0 && (
          <div>
            <div className="eyebrow mb-2">{t("portal.examples")}</div>
            <div className="space-y-2">
              {examples.map((ex) => (
                <button key={ex} type="button" onClick={() => { setText(ex); ref.current?.focus(); }} className="block w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-[13px] text-muted-foreground transition hover:border-foreground/40 hover:text-foreground">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.length > 0 && (
          <ul className="space-y-3">
            {messages.map((m, i) => (
              <li key={i} className={m.role === "user" ? "ml-6" : "mr-2"}>
                <div className="eyebrow mb-1">{m.role === "user" ? t("portal.you") : t("portal.agent")}</div>
                <div className={`rounded-md px-3 py-2 text-[13px] leading-relaxed ${m.role === "user" ? "bg-foreground text-background" : m.error ? "border border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-200" : "border border-border"}`}>
                  {m.text}
                  {m.retry && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => send(m.retry!.request, m.retry!.client)}>{t("common.retry")}</button>
                      <button className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => send(m.retry!.request, m.retry!.client, "rule_based")}>{t("portal.useRuleBased")}</button>
                    </div>
                  )}
                </div>
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5" /> {t("portal.analysing")}</li>
            )}
          </ul>
        )}

        {projects.length > 0 && (
          <div>
            <div className="eyebrow mb-2">{t("portal.recent")}</div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {projects.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p.id)} className={`block w-full px-3 py-2 text-left transition hover:bg-muted ${p.id === currentId ? "bg-muted" : ""}`}>
                    <div className="truncate text-[13px]">{p.title}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <StatusBadge s={p.status} />
                      <span className="font-mono text-[11px] text-muted-foreground">{p.design ? eur(p.design.cost.total) : ""}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-4">
        <input className="input mb-2 py-1.5 text-xs" placeholder={t("portal.clientPlaceholder")} value={client} onChange={(e) => setClient(e.target.value)} />
        <div className="relative">
          <textarea
            ref={ref}
            rows={3}
            className="input resize-none pr-12"
            placeholder={t("portal.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            aria-label={t("common.submit")}
            disabled={busy || text.trim().length < 5}
            onClick={() => send()}
            className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-md bg-foreground text-background transition hover:opacity-90 disabled:opacity-30"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <span aria-hidden>↑</span>}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">{t("portal.hint")}</div>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ center: empty state

function EmptyProject() {
  const t = useT();
  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="eyebrow">{t("proj.eyebrow")}</div>
        <div className="mt-1 text-sm">{t("proj.none")}</div>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-muted/60 px-6 py-2">
        <span className="eyebrow mr-3">{t("proj.generation")}</span>
        {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground/60">
            <span className="font-mono text-[10px]">{String(s).padStart(2, "0")}</span> {t(`stage.${s}` as MessageKey)}
          </span>
        ))}
      </div>
      <div className="grid flex-1 place-items-center px-6 py-16">
        <div className="max-w-lg text-center">
          <div className="eyebrow">{t("proj.emptyEyebrow")}</div>
          <h2 className="mt-3 text-lg font-medium tracking-tight">{t("proj.emptyTitle")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("proj.emptyLead")}</p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ right: inventory

function InventoryPanel({ products, project }: { products: Product[]; project: Project | null }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [onlyShort, setOnlyShort] = useState(false);

  const required = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of project?.design?.bom ?? []) if (l.sku) m.set(l.sku, (m.get(l.sku) ?? 0) + l.quantity);
    return m;
  }, [project]);

  const value = products.reduce((s, p) => s + p.stock_quantity * p.purchase_price_eur, 0);
  const low = products.filter((p) => productStockStatus(p) === "LOW_STOCK").length;
  const out = products.filter((p) => productStockStatus(p) === "OUT_OF_STOCK").length;
  const filtered = products.filter((p) => {
    if (onlyShort && productStockStatus(p) === "IN_STOCK") return false;
    const s = q.trim().toLowerCase();
    return !s || p.sku.toLowerCase().includes(s) || p.name.toLowerCase().includes(s);
  });
  const categories = Array.from(new Set(filtered.map((p) => p.category)));

  return (
    <aside className="flex min-h-0 flex-col border-t border-border lg:col-span-2 lg:border-t xl:col-span-1 xl:border-t-0">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{t("inv.eyebrow")}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{products.length} SKU</span>
        </div>
        <div className="mt-1 text-sm">{t("inv.title")}</div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div><div className="eyebrow">{t("inv.value")}</div><div className="mt-1 font-mono text-sm">{eur(value).replace(",00", "")}</div></div>
          <div><div className="eyebrow">{t("inv.low")}</div><div className="mt-1 font-mono text-sm">{low}</div></div>
          <div><div className="eyebrow">{t("inv.missing")}</div><div className="mt-1 font-mono text-sm">{out}</div></div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <input className="input py-1.5 text-xs" placeholder={t("inv.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex shrink-0 rounded-md border border-border p-0.5 text-[11px]">
          <button type="button" onClick={() => setOnlyShort(false)} className={`rounded px-2 py-1 ${!onlyShort ? "bg-foreground text-background" : "text-muted-foreground"}`}>{t("inv.all")}</button>
          <button type="button" onClick={() => setOnlyShort(true)} className={`rounded px-2 py-1 ${onlyShort ? "bg-foreground text-background" : "text-muted-foreground"}`}>{t("inv.shortages")}</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {categories.length === 0 && <p className="px-5 py-6 text-xs text-muted-foreground">{t("inv.noResults")}</p>}
        {categories.map((cat) => (
          <div key={cat}>
            <div className="eyebrow sticky top-0 border-b border-border bg-background px-5 py-2">{cat}</div>
            <ul className="divide-y divide-border">
              {filtered.filter((p) => p.category === cat).map((p) => {
                const req = required.get(p.sku);
                const status = productStockStatus(p);
                return (
                  <li key={p.sku} className={`flex items-start justify-between gap-3 px-5 py-2.5 ${req ? "bg-muted" : ""}`}>
                    <div className="min-w-0">
                      <div className="truncate text-[13px]" title={p.name}>{p.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{p.sku} · {p.selling_price_eur.toFixed(2)} €/{p.unit === "meter" ? "m" : p.unit}</div>
                      {req !== undefined && <div className="mt-1 inline-block rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background">{t("inv.inProject", { qty: req })}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`font-mono text-[13px] ${status === "OUT_OF_STOCK" ? "text-red-600 dark:text-red-400" : ""}`}>
                        {p.stock_quantity} <span className="text-muted-foreground">{p.unit === "meter" ? "m" : p.unit}</span>
                      </div>
                      {status !== "IN_STOCK" && <div className="text-[10px] text-amber-700 dark:text-amber-300">{t("inv.belowMin")}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">{project?.design ? t("inv.footerProject") : t("inv.footerIdle")}</div>
    </aside>
  );
}
