"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo } from "react";
import { LANG_COOKIE, LANGS, translator, type Lang, type TFunction } from "@/lib/i18n";

const LangContext = createContext<{ lang: Lang; t: TFunction }>({ lang: "sq", t: translator("sq") });

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, t: translator(lang) }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT() {
  return useContext(LangContext).t;
}

export function useLang() {
  return useContext(LangContext).lang;
}

/** SQ | EN switch — stores the choice in a cookie and re-renders server components. */
export function LangToggle() {
  const lang = useLang();
  const router = useRouter();
  const t = useT();
  return (
    <div role="group" aria-label={t("lang.label")} className="flex items-center rounded-md border border-border p-0.5 text-[11px] font-medium">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => {
            document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
            router.refresh();
          }}
          className={`rounded px-2 py-1 uppercase transition ${lang === l ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
