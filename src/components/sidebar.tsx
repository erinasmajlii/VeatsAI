"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/projects", label: "Projects", icon: "M3 7h18M3 12h18M3 17h12" },
  { href: "/projects/new", label: "New Project", icon: "M12 5v14M5 12h14" },
  { href: "/inventory", label: "Inventory", icon: "M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 17l8 4 8-4" },
  { href: "/quotes", label: "Quotes", icon: "M7 3h7l5 5v13H7zM14 3v5h5" },
  { href: "/standards", label: "Standards", icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 5V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 11h.1a2 2 0 110 4z" },
];

export function Sidebar() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : href === "/projects" ? path === "/projects" || (/^\/projects\/(?!new)/.test(path)) : path.startsWith(href));
  return (
    <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-slate-300 md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500 font-bold text-slate-950">V</div>
        <div>
          <div className="text-sm font-semibold text-white">VeatsAI</div>
          <div className="text-[11px] text-slate-500">Electrical engineering platform</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active(n.href) ? "bg-slate-800 text-white" : "hover:bg-slate-900 hover:text-white"}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={n.icon} />
            </svg>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="m-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
        AI-assisted, standards-referenced preliminary engineering. All results require engineer approval.
      </div>
    </aside>
  );
}
