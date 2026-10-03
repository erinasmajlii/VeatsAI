import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { authenticate, SESSION_COOKIE, SESSION_TTL_S } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/login — engineer sign-in. Sets an httpOnly signed session cookie. */
export async function POST(req: Request) {
  try {
    const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).parse(await req.json().catch(() => ({})));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const { user, token } = await authenticate(body.email, body.password, ip);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_S });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
