"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useT } from "@/components/i18n";
import { Notice, Spinner } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n";

const MAX_BYTES = 30 * 1024 * 1024;
const GENERIC: Record<string, MessageKey> = { UNAUTHENTICATED: "err.UNAUTHENTICATED", FORBIDDEN: "err.FORBIDDEN", INTERNAL: "err.INTERNAL", DATABASE: "err.DATABASE" };
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Requests Portal: a written request, an AutoCAD plan (.dwg / .dxf), or both.
 * A plan is validated and analysed on the server before the project opens.
 */
export function RequestForm() {
  const t = useT();
  const router = useRouter();
  const [client, setClient] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (!/\.(dwg|dxf)$/i.test(f.name)) return setError(t("req.badType"));
    if (f.size > MAX_BYTES) return setError(t("req.tooBig"));
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!file && description.trim().length < 5) return setError(t("req.needInput"));
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (file) {
        const f = new FormData();
        f.set("file", file);
        if (client.trim()) f.set("client_name", client.trim());
        if (title.trim()) f.set("title", title.trim());
        if (description.trim()) f.set("description", description.trim());
        res = await fetch("/api/plans", { method: "POST", body: f });
      } else {
        res = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request: description, client_name: client.trim() || undefined, standard: "IEC" }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return router.push("/login");
      if (!res.ok) {
        const known = data.code && GENERIC[data.code as string];
        setError(known ? t(known) : [data.error, ...(data.issues ?? [])].filter(Boolean).join(" — ") || t("err.INTERNAL"));
        return;
      }
      router.push(`/projects/${data.id}${file ? "?tab=plan" : ""}`);
    } catch {
      setError(t("err.NETWORK"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" noValidate>
      <div className="card space-y-5 p-6">
        <h2 className="card-t">{t("req.details")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="client" className="label">{t("req.client")}</label>
            <input id="client" className="input" placeholder={t("req.clientPh")} value={client} onChange={(e) => setClient(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label htmlFor="standard" className="label">{t("req.standard")}</label>
            <select id="standard" className="input" defaultValue="IEC" disabled>
              <option value="IEC">IEC</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="title" className="label">{t("req.projectTitle")}</label>
          <input id="title" className="input" placeholder={t("req.projectTitlePh")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={!file} />
        </div>
        <div>
          <label htmlFor="description" className="label">{t("req.description")}</label>
          <textarea id="description" rows={4} className="input resize-y" placeholder={t("req.descriptionPh")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          {file && <p className="mt-1 text-[11px] text-muted-foreground">{t("req.planWithText")}</p>}
        </div>

        <div>
          <div className="label">{t("req.plan")}</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition ${drag ? "border-accent bg-accent-soft" : "border-border bg-muted"}`}
          >
            {file ? (
              <>
                <Icon name="file" className="h-6 w-6 text-accent" />
                <div className="text-sm font-medium">{file.name}</div>
                <div className="text-xs text-muted-foreground">{fmtSize(file.size)}</div>
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ""; }} disabled={busy}>{t("req.planRemove")}</button>
              </>
            ) : (
              <>
                <Icon name="upload" className="h-6 w-6 text-muted-foreground" />
                <div className="text-sm font-medium">{t("req.plan")}</div>
                <div className="text-xs text-muted-foreground">{t("req.planHint")}</div>
                <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => inputRef.current?.click()}>{t("req.planChoose")}</button>
                <div className="text-[11px] text-muted-foreground">{t("req.planSupported")}</div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".dwg,.dxf" className="sr-only" aria-label={t("req.plan")} onChange={(e) => pick(e.target.files?.[0])} />
          </div>
        </div>

        {error && <Notice kind="error" onClose={() => setError(null)}>{error}</Notice>}
        {busy && file && <Notice kind="info"><span className="inline-flex items-center gap-2"><Spinner className="h-3.5 w-3.5" /> {t("req.analysingPlan")}</span></Notice>}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary px-5" disabled={busy}>
            {busy ? <><Spinner /> {t("req.submitting")}</> : t("req.submit")}
          </button>
        </div>
      </div>

      <aside className="space-y-3 lg:pt-1">
        <h2 className="card-t">{t("req.next.title")}</h2>
        {([1, 2, 3, 4] as const).map((n) => (
          <div key={n} className="card flex items-center gap-3 px-4 py-3">
            <span className="font-mono text-[11px] font-medium text-accent">{String(n).padStart(2, "0")}</span>
            <span className="text-[13px]">{t(`req.next.${n}` as MessageKey)}</span>
          </div>
        ))}
      </aside>
    </form>
  );
}
