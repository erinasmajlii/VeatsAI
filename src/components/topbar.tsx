"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/lib/i18n";
import { LangToggle, useT } from "./i18n";
import { LogoMark } from "./ui";

const NAV: { href: string; key: MessageKey }[] = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/projects", key: "nav.projects" },
  { href: "/inventory", key: "nav.inventory" },
  { href: "/quotes", key: "nav.quotes" },
  { href: "/standards", key: "nav.standards" },
  { href: "/settings", key: "nav.settings" },
];

export const THEME_KEY = "veats-theme";

export function ThemeToggle() {
  const t = useT();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    // Sync with the class set by the pre-paint script in layout.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {}
    setDark(next);
  }
  return (
    <button type="button" onClick={toggle} aria-label={t("theme.toggle")} title={t("theme.toggle")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-foreground">
      <LogoMark />
      <span className="text-[13px] font-medium tracking-[0.28em]">VEATSAI</span>
    </Link>
  );
}

export function TopBar() {
  const path = usePathname();
  const t = useT();

  if (path === "/") {
    return (
      <header className="no-print sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
          <Brand />
          <nav className="flex items-center gap-1 sm:gap-3">
            <a href="#how" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground sm:block">{t("nav.how")}</a>
            <a href="#modules" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground sm:block">{t("nav.modules")}</a>
            <LangToggle />
            <ThemeToggle />
            <Link href="/dashboard" className="btn-primary px-3 py-1.5">
              {t("nav.enter")} <span aria-hidden>→</span>
            </Link>
          </nav>
        </div>
      </header>
    );
  }

  const active = (href: string) => path === href || (href === "/projects" && path.startsWith("/projects")) || (href !== "/projects" && path.startsWith(href + "/"));
  const current = NAV.find((n) => active(n.href));
  return (
    <header className="no-print sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-5">
        <Brand />
        {current && <span className="hidden border-l border-border pl-4 text-sm text-muted-foreground lg:block">{t(current.key)}</span>}
        <nav aria-label="Main" className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${active(n.href) ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
