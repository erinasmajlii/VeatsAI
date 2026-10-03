"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { MessageKey } from "@/lib/i18n";
import type { SessionUser } from "@/lib/types";
import { Assistant } from "./assistant";
import { Logo, LogoMark } from "./brand";
import { Icon, type IconName } from "./icons";
import { LangToggle, useT } from "./i18n";
import { ThemeToggle } from "./theme-toggle";
import { UserProvider } from "./user-context";

const NAV: { href: string; key: MessageKey; icon: IconName }[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: "dashboard" },
  { href: "/projects", key: "nav.projects", icon: "projects" },
  { href: "/requests", key: "nav.requests", icon: "requests" },
  { href: "/quotes", key: "nav.quotes", icon: "quotes" },
  { href: "/inventory", key: "nav.inventory", icon: "inventory" },
  { href: "/standards", key: "nav.standards", icon: "standards" },
  { href: "/about", key: "nav.about", icon: "about" },
];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/**
 * Application shell for signed-in pages:
 *   sidebar | page content | assistant (pinned on the right)
 * Desktop (≥1280px): all three are docked. Laptop / tablet: the assistant becomes a drawer opened from a button,
 * and below 1024px the sidebar becomes a drawer too — the content area is never covered permanently.
 */
export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const t = useT();
  const path = usePathname();
  const router = useRouter();
  // A drawer is open only for the page it was opened on, so navigating closes it without an effect.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const [chatAt, setChatAt] = useState<string | null>(null);
  const menu = menuAt === path;
  const chat = chatAt === path;

  const active = (href: string) => path === href || path.startsWith(href + "/");

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <UserProvider user={user}>
      <div className="app-shell flex h-dvh overflow-hidden bg-background text-foreground">
        {(menu || chat) && (
          <button
            type="button"
            aria-label={t("common.close")}
            className="no-print fixed inset-0 z-40 bg-black/40 xl:hidden"
            onClick={() => { setMenuAt(null); setChatAt(null); }}
          />
        )}

        {/* ------------------------------------------------ sidebar */}
        <aside
          id="app-sidebar"
          className={`no-print fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col gap-6 border-r border-border bg-muted px-4 py-5 transition-transform lg:static lg:z-auto lg:w-[232px] lg:shrink-0 lg:translate-x-0 ${menu ? "translate-x-0" : "-translate-x-full max-lg:invisible"}`}
        >
          <div className="flex items-center justify-between px-1">
            <Link href="/dashboard" aria-label="VEATSAI" className="text-foreground">
              <Logo className="h-7 w-auto" />
            </Link>
            <button type="button" onClick={() => setMenuAt(null)} aria-label={t("nav.closeMenu")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-card lg:hidden">
              <Icon name="close" />
            </button>
          </div>

          <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition ${active(n.href) ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}
              >
                <Icon name={n.icon} className="h-4 w-4 shrink-0" />
                {t(n.key)}
              </Link>
            ))}
          </nav>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <LangToggle />
              <ThemeToggle />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden>
                {initials(user.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{user.name}</div>
                <div className="text-[11px] text-muted-foreground">{t(`role.${user.role}` as MessageKey)}</div>
              </div>
              <button type="button" onClick={signOut} aria-label={t("nav.signOut")} title={t("nav.signOut")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </aside>

        {/* ------------------------------------------------ content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 lg:hidden">
            <button type="button" onClick={() => setMenuAt(path)} aria-label={t("nav.openMenu")} aria-expanded={menu} aria-controls="app-sidebar" className="grid h-9 w-9 place-items-center rounded-md text-foreground hover:bg-muted">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <Link href="/dashboard" className="text-foreground" aria-label="VEATSAI">
              <LogoMark className="h-6 w-6" />
            </Link>
          </header>
          <main className="app-main min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>

        {/* ------------------------------------------------ assistant (right) */}
        <aside
          id="app-assistant"
          className={`no-print fixed inset-y-0 right-0 z-50 flex w-[min(100vw,400px)] flex-col border-l border-border bg-card shadow-xl transition-transform xl:static xl:z-auto xl:w-[360px] xl:shrink-0 xl:translate-x-0 xl:shadow-none ${chat ? "translate-x-0" : "translate-x-full max-xl:invisible"}`}
        >
          <Assistant onClose={() => setChatAt(null)} />
        </aside>

        {!chat && (
          <button
            type="button"
            onClick={() => setChatAt(path)}
            aria-expanded={chat}
            aria-controls="app-assistant"
            className="no-print fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground shadow-lg transition hover:opacity-90 xl:hidden"
          >
            <Icon name="chat" />
            {t("nav.assistant")}
          </button>
        )}
      </div>
    </UserProvider>
  );
}
