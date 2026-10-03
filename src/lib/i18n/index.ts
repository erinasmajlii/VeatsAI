import { MESSAGES, type MessageKey } from "./messages";

export type Lang = "sq" | "en";
export type { MessageKey };
export const LANGS: Lang[] = ["sq", "en"];
export const DEFAULT_LANG: Lang = "sq";
export const LANG_COOKIE = "veats-lang";

export function isLang(v: unknown): v is Lang {
  return v === "sq" || v === "en";
}

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(lang: Lang): TFunction {
  const dict = MESSAGES[lang];
  return (key, vars) => {
    let s: string = dict[key] ?? MESSAGES.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export const LOCALE: Record<Lang, string> = { sq: "sq-AL", en: "en-GB" };
