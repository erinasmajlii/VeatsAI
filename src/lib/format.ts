import { LOCALE, type Lang } from "./i18n";

export const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export const fmtDate = (s: string, lang: Lang = "en") =>
  new Date(s).toLocaleString(LOCALE[lang], { dateStyle: "medium", timeStyle: "short" });
