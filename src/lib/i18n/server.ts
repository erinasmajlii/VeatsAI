import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LANG, isLang, LANG_COOKIE, translator, type Lang } from ".";

/** Current UI language from the cookie (server components / route handlers). */
export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : DEFAULT_LANG;
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: translator(lang) };
}
