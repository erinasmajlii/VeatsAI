import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { LangToggle } from "@/components/i18n";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionUser } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/** Only same-site relative paths are accepted as the post-login destination (no open redirect). */
function safeNext(next?: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login") || next.startsWith("/api")) return "/dashboard";
  return next;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = safeNext(next);
  if (await getSessionUser()) redirect(dest);
  const { t } = await getT();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between border-r border-border bg-muted p-12 lg:flex">
        <Link href="/" aria-label="VEATSAI" className="text-foreground">
          <Logo className="h-9 w-auto" />
        </Link>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">{t("login.pitch.title")}</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("login.pitch.lead")}</p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} VEATSAI</p>
      </aside>
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">{t("login.home")}</Link>
          <div className="flex items-center gap-1.5">
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <Link href="/" aria-label="VEATSAI" className="mb-10 text-foreground lg:hidden">
            <Logo className="h-8 w-auto" />
          </Link>
          <LoginForm next={dest} />
        </div>
      </main>
    </div>
  );
}
