"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n";
import { Notice, Spinner } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setError(res.status === 401 ? t("login.error") : res.status === 429 ? t("err.RATE_LIMITED") : res.status === 422 ? t("login.error") : t("err.INTERNAL"));
    } catch {
      setError(t("err.NETWORK"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("login.lead")}</p>
      </div>
      <div>
        <label htmlFor="email" className="label">{t("login.email")}</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="password" className="label">{t("login.password")}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || !email || !password}>
        {busy ? <><Spinner /> {t("login.submitting")}</> : t("login.submit")}
      </button>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("login.note")}</p>
    </form>
  );
}
