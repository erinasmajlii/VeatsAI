import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — the signed-in user (role is read from the database). */
export async function GET() {
  const user = await getSessionUser();
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: "Please sign in to continue.", code: "UNAUTHENTICATED" }, { status: 401 });
}
