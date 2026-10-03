import { NextResponse, type NextRequest } from "next/server";
import { authSecret } from "@/lib/auth/secret";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/token";

/**
 * Route protection.
 * - Public: the landing/intro page, the login page and the auth endpoints.
 * - Everything else needs a valid signed session cookie: pages redirect to /login, API calls get 401 JSON.
 * - State-changing API calls must come from the same origin (CSRF defence on top of SameSite=Lax).
 * The route handlers re-check the user (and role) against the database; this layer is the first gate only.
 */

const PUBLIC_PAGES = new Set(["/", "/login"]);
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/me"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin) {
      let host = "";
      try { host = new URL(origin).host; } catch { /* invalid origin */ }
      if (host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-site request blocked.", code: "FORBIDDEN" }, { status: 403 });
    }
  }

  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API.has(pathname)) return NextResponse.next();

  const valid = verifyToken(req.cookies.get(SESSION_COOKIE)?.value, authSecret());
  if (valid) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // everything except Next internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map|txt)$).*)"],
};
