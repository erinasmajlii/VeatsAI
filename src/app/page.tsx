import Link from "next/link";
import { CircuitBackground } from "@/components/circuit-background";
import { Logo, LogoMark } from "@/components/brand";
import { LangToggle } from "@/components/i18n";
import { Intro } from "@/components/intro";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionUser } from "@/lib/auth";
import { repo } from "@/lib/db";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const STEPS = [1, 2, 3, 4, 5, 6] as const;
const MODULES = [1, 2, 3, 4, 5, 6] as const;

export default async function Landing() {
  const { t } = await getT();
  const [user, products, projects] = await Promise.all([getSessionUser(), repo().listProducts(), repo().listProjects()]);
  const cta = user ? { href: "/dashboard", label: t("nav.dashboard") } : { href: "/login", label: t("nav.login") };
  const stats: [string | number, string][] = [
    [products.length, t("land.stat.catalog")],
    [STEPS.length, t("land.stat.stages")],
    [projects.length, t("land.stat.projects")],
    [projects.filter((p) => p.status === "APPROVED" || p.status === "RELEASED").length, t("land.stat.approved")],
  ];

  return (
    <div>
      <Intro />

      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="VEATSAI" className="text-foreground">
            <Logo className="hidden h-7 w-auto sm:block" />
            <LogoMark className="h-7 w-7 sm:hidden" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <a href="#how" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground md:block">{t("nav.how")}</a>
            <a href="#modules" className="hidden px-2 text-sm text-muted-foreground hover:text-foreground md:block">{t("nav.modules")}</a>
            <LangToggle />
            <ThemeToggle />
            <Link href={cta.href} className="btn-primary px-3.5 py-1.5">{cta.label}</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <CircuitBackground />
        <div className="relative mx-auto max-w-6xl px-5 pb-24 pt-20 sm:px-8 sm:pt-28">
          <div className="max-w-3xl">
            <div className="eyebrow fade-up">{t("land.eyebrow")}</div>
            <h1 className="fade-up mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl" style={{ animationDelay: "60ms" }}>
              {t("land.title1")}
              <br />
              {t("land.title2")}
            </h1>
            <p className="fade-up mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg" style={{ animationDelay: "120ms" }}>{t("land.lead")}</p>
            <div className="fade-up mt-9 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
              <Link href={cta.href} className="btn-primary px-5 py-2.5">{user ? cta.label : t("land.ctaPrimary")}</Link>
              <a href="#how" className="btn-ghost px-5 py-2.5">{t("land.ctaSecondary")}</a>
            </div>
            <p className="fade-up mt-6 text-xs text-muted-foreground" style={{ animationDelay: "240ms" }}>{t("land.note")}</p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border">
        <div className="mx-auto grid max-w-6xl grid-cols-2 px-5 sm:px-8 lg:grid-cols-4">
          {stats.map(([value, label], i) => (
            <div key={i} className={`py-7 pr-6 ${i > 0 ? "lg:border-l lg:border-border lg:pl-6" : ""} ${i % 2 === 1 ? "border-l border-border pl-6" : ""}`}>
              <div className="font-mono text-2xl tabular-nums">{value}</div>
              <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8">
        <div className="eyebrow">{t("land.how.eyebrow")}</div>
        <h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-tight">{t("land.how.title")}</h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((n) => (
            <li key={n} className="card p-5">
              <span className="font-mono text-[11px] font-medium text-accent">{String(n).padStart(2, "0")}</span>
              <div className="mt-2 text-[15px] font-semibold">{t(`land.step.${n}.t` as MessageKey)}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t(`land.step.${n}.d` as MessageKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Capabilities */}
      <section id="modules" className="scroll-mt-20 border-t border-border bg-muted/50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="eyebrow">{t("land.mod.eyebrow")}</div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">{t("land.mod.title")}</h2>
          <div className="mt-10 grid gap-x-12 md:grid-cols-2">
            {MODULES.map((n) => (
              <div key={n} className="border-t border-border py-6">
                <div className="text-sm font-semibold">{t(`land.mod.${n}.t` as MessageKey)}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t(`land.mod.${n}.d` as MessageKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-16 sm:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t("land.cta.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("land.cta.lead")}</p>
          </div>
          <Link href={cta.href} className="btn-primary px-5 py-2.5">{cta.label}</Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground sm:px-8">
          <span className="flex items-center gap-2">
            <LogoMark className="h-4 w-4" /> © {new Date().getFullYear()} VEATSAI · {t("land.footer")}
          </span>
          <span>{t("land.footer.right")}</span>
        </div>
      </footer>
    </div>
  );
}
