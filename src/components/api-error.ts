import type { MessageKey, TFunction } from "@/lib/i18n";

const MAP: Record<string, MessageKey> = {
  NETWORK: "err.NETWORK",
  UNAUTHENTICATED: "err.UNAUTHENTICATED",
  FORBIDDEN: "err.FORBIDDEN",
  RATE_LIMITED: "err.RATE_LIMITED",
  INTERNAL: "err.INTERNAL",
  DATABASE: "err.DATABASE",
};

export interface ApiErrorBody {
  error?: string;
  code?: string;
  detail?: string;
  issues?: string[];
}

/** User-facing text for a failed API call. Known generic codes are translated; specific messages come from the server. */
export function errorMessage(t: TFunction, data: ApiErrorBody | null | undefined): string {
  if (data?.code && MAP[data.code]) return t(MAP[data.code]);
  return [data?.error, data?.detail, ...(data?.issues ?? [])].filter(Boolean).join(" — ") || t("err.INTERNAL");
}

/** fetch + JSON, returning a uniform result. Network failures become `{ ok:false, status:0 }`. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ ok: boolean; status: number; data: T & ApiErrorBody }> {
  try {
    const { json, ...rest } = init ?? {};
    const res = await fetch(url, json !== undefined ? { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json", ...(rest.headers ?? {}) }, body: JSON.stringify(json) } : rest);
    const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      // hard navigation on purpose: an expired session should also reset all client state
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { code: "NETWORK" } as T & ApiErrorBody };
  }
}

export const networkMessage = (t: TFunction) => t("err.NETWORK");
