"use client";

import { useSyncExternalStore } from "react";
import { fmtDate } from "@/lib/format";
import { useLang } from "./i18n";

const noop = () => () => {};

/**
 * Date/time in the viewer's own locale and time zone.
 * The server cannot know either, so it renders a stable UTC string and the browser swaps in the local one right after
 * hydration (useSyncExternalStore) — no hydration mismatch.
 */
export function useLocalDate(iso: string | null | undefined): string {
  const lang = useLang();
  return useSyncExternalStore(
    noop,
    () => (iso ? fmtDate(iso, lang) : ""),
    () => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : ""),
  );
}

export function LocalTime({ iso }: { iso: string | null | undefined }) {
  const text = useLocalDate(iso);
  return iso ? <time dateTime={iso}>{text}</time> : <>—</>;
}
