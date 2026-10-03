"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CRITICAL_FIELDS } from "@/lib/engineering/inputs";
import type { MessageKey } from "@/lib/i18n";
import type { Project } from "@/lib/types";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { Spinner } from "./ui";

type Msg = {
  role: "user" | "agent";
  text: string;
  error?: boolean;
  retry?: { request: string; client: string };
  project?: { id: string; title: string };
};

const GENERIC: Record<string, MessageKey> = { UNAUTHENTICATED: "err.UNAUTHENTICATED", FORBIDDEN: "err.FORBIDDEN", RATE_LIMITED: "err.RATE_LIMITED", INTERNAL: "err.INTERNAL", DATABASE: "err.DATABASE" };

/**
 * Assistant panel — pinned to the right of the application. Turns a written request into a project.
 * Projects are listed only on the Projects page; this panel never duplicates that list.
 */
export function Assistant({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

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
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const known = data.code && GENERIC[data.code as string];
        const msg = known ? t(known) : [data.error, ...(data.issues ?? [])].filter(Boolean).join(" — ") || t("err.INTERNAL");
        setMessages((m) => [...m, { role: "agent", error: true, text: msg, retry: data.fallback_available ? { request, client: clientName } : undefined }]);
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
      ].join(" ");
      setMessages((m) => [...m, { role: "agent", text: reply, project: { id: p.id, title: p.title } }]);
      setClient("");
      router.refresh();
    } catch {
      setMessages((m) => [...m, { role: "agent", error: true, text: t("err.NETWORK") }]);
    } finally {
      setBusy(false);
    }
  }

  const examples = [t("portal.ex.1"), t("portal.ex.2"), t("portal.ex.3")];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t("portal.eyebrow")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("portal.title")}</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t("portal.collapse")} title={t("portal.collapse")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground xl:hidden">
            <Icon name="close" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm" aria-live="polite">
        <div className="rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-relaxed">
          {t("portal.greeting")}
          <Link href="/requests" className="mt-1.5 block text-xs font-medium text-accent hover:underline">
            {t("portal.openRequests")}
          </Link>
        </div>

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
                <div className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed ${m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "border border-danger/30 bg-danger-soft text-danger" : "bg-muted"}`}>
                  {m.text}
                  {m.project && (
                    <Link href={`/projects/${m.project.id}`} className="mt-2 block rounded-md border border-border bg-card px-3 py-2 text-foreground transition hover:border-foreground/30">
                      <span className="block text-[11px] font-medium text-success">{t("portal.created")}</span>
                      <span className="mt-0.5 block truncate text-[13px] font-medium">{m.project.title}</span>
                      <span className="mt-0.5 block text-xs font-medium text-accent">{t("portal.openProject")}</span>
                    </Link>
                  )}
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
        <div ref={endRef} />
      </div>

      <div className="border-t border-border px-4 py-4">
        <input className="input mb-2 py-1.5 text-xs" placeholder={t("portal.clientPlaceholder")} value={client} onChange={(e) => setClient(e.target.value)} aria-label={t("req.client")} />
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
            className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Icon name="send" />}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">{t("portal.hint")}</div>
      </div>
    </div>
  );
}
