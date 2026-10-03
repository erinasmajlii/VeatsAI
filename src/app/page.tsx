import Link from "next/link";
import { LogoMark } from "@/components/ui";
import { repo } from "@/lib/db";
import type { MessageKey } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const MODULES = [1, 2, 3, 4, 5, 6] as const;

export default async function Landing() {
  const { t } = await getT();
  const db = repo();
  const [products, projects] = await Promise.all([db.listProducts(), db.listProjects()]);
  const stats: [string | number, string][] = [
    [products.length, t("land.stat.catalog")],
    [8, t("land.stat.stages")],
    [projects.length, t("land.stat.projects")],
    [projects.filter((p) => p.status === "APPROVED").length, t("land.stat.approved")],
  ];

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-24 sm:pt-32">
        <div className="max-w-3xl">
          <div className="eyebrow fade-up">{t("land.eyebrow")}</div>
          <h1 className="fade-up mt-6 text-5xl font-normal leading-[1.05] tracking-tight sm:text-6xl" style={{ animationDelay: "60ms" }}>
            {t("land.title1")}
            <br />
            {t("land.title2")}
          </h1>
          <p className="fade-up mt-7 max-w-2xl text-base leading-relaxed text-muted-foreground" style={{ animationDelay: "120ms" }}>
            {t("land.lead")}
          </p>
          <div className="fade-up mt-9 flex flex-wrap gap-3" style={{ animationDelay: "180ms" }}>
            <Link href="/dashboard" className="btn-primary px-5 py-2.5">
              {t("land.ctaPrimary")} <span aria-hidden>→</span>
            </Link>
            <a href="#how" className="btn-ghost px-5 py-2.5">{t("land.ctaSecondary")}</a>
          </div>
          <p className="fade-up mt-6 text-xs text-muted-foreground" style={{ animationDelay: "240ms" }}>{t("land.note")}</p>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border">
        <div className="mx-auto grid max-w-6xl grid-cols-2 px-6 lg:grid-cols-4">
          {stats.map(([value, label], i) => (
            <div key={i} className={`py-8 pr-6 ${i > 0 ? "lg:border-l lg:border-border lg:pl-6" : ""} ${i % 2 === 1 ? "border-l border-border pl-6 lg:pl-6" : ""}`}>
              <div className="font-mono text-2xl tabular-nums">{value}</div>
              <div className="mt-2 text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-24">
        <div className="eyebrow">{t("land.how.eyebrow")}</div>
        <h2 className="mt-4 max-w-xl text-3xl font-normal tracking-tight">{t("land.how.title")}</h2>
        <ol className="mt-12 grid gap-x-16 md:grid-cols-2">
          {STEPS.map((n) => (
            <li key={n} className="flex gap-5 border-t border-border py-6">
              <span className="font-mono text-[11px] text-muted-foreground">{String(n).padStart(2, "0")}</span>
              <div>
                <div className="text-sm font-medium">{t(`land.step.${n}.t` as MessageKey)}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`land.step.${n}.d` as MessageKey)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Modules */}
      <section id="modules" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="eyebrow">{t("land.mod.eyebrow")}</div>
          <h2 className="mt-4 text-3xl font-normal tracking-tight">{t("land.mod.title")}</h2>
          <div className="mt-12 grid gap-x-16 md:grid-cols-2">
            {MODULES.map((n) => (
              <div key={n} className="border-t border-border py-6">
                <div className="text-sm font-medium">{t(`land.mod.${n}.t` as MessageKey)}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`land.mod.${n}.d` as MessageKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-20">
          <div>
            <h2 className="text-2xl font-normal tracking-tight">{t("land.cta.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("land.cta.lead")}</p>
          </div>
          <Link href="/dashboard" className="btn-primary px-5 py-2.5">
            {t("nav.enter")} <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <LogoMark className="h-4 w-4" /> © {new Date().getFullYear()} VeatsAI · {t("land.footer")}
          </span>
          <span>{t("land.footer.right")}</span>
        </div>
      </footer>
    </div>
  );
}
