"use client";

import { useState } from "react";
import { useT } from "@/components/i18n";

export function SeedButton() {
  const t = useT();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      <button
        className="btn-ghost py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          if (!confirm(t("page.settings.reseedConfirm"))) return;
          setBusy(true);
          const res = await fetch("/api/admin/seed", { method: "POST" });
          const data = await res.json();
          setMsg(res.ok ? `✓ ${data.products} SKU · ${data.standards} standards` : data.error);
          setBusy(false);
        }}
      >
        {t("page.settings.reseed")}
      </button>
    </div>
  );
}
