"use client";

import { useState } from "react";

export function SeedButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
      <button
        className="btn-ghost py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Reset product catalog and stock levels to the seed data?")) return;
          setBusy(true);
          const res = await fetch("/api/admin/seed", { method: "POST" });
          const data = await res.json();
          setMsg(res.ok ? `Seeded ${data.products} products, ${data.standards} standards.` : data.error);
          setBusy(false);
        }}
      >
        Re-seed database
      </button>
    </div>
  );
}
