import "server-only";
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { repo } from "../db";
import type { SessionUser, UserRecord } from "../types";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";
import { authSecret } from "./secret";
import { SESSION_COOKIE, SESSION_TTL_S, signToken, verifyToken } from "./token";

export { SESSION_COOKIE, SESSION_TTL_S };

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 | 429 = 401,
  ) {
    super(message);
  }
}

const toSession = (u: UserRecord): SessionUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

/** Resolves the signed-in user for this request (null when signed out, expired or deactivated). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = verifyToken(token, authSecret());
  if (!payload) return null;
  const user = await repo().getUserById(payload.uid);
  if (!user || !user.active) return null;
  return toSession(user);
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError("Please sign in to continue.", 401);
  return u;
}

/** Approval and release are engineer-only actions; the role is checked against the database, never the client. */
export async function requireEngineer(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "engineer") throw new AuthError("Only engineers can perform this action.", 403);
  return u;
}

// ------------------------------------------------------------------ sign-in

interface Attempt {
  count: number;
  resetAt: number;
}
const g = globalThis as unknown as { __veatsAttempts?: Map<string, Attempt>; __veatsSeeded?: boolean };
const attempts = (g.__veatsAttempts ??= new Map<string, Attempt>());
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 10 * 60 * 1000;

function throttle(key: string) {
  const a = attempts.get(key);
  if (a && a.resetAt > Date.now() && a.count >= MAX_ATTEMPTS) throw new AuthError("Too many sign-in attempts. Try again in a few minutes.", 429);
}
function failed(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else a.count++;
}

/** Creates the engineer defined by ENGINEER_SEED_* once, so a fresh install can sign in. */
export async function ensureSeedEngineer() {
  if (g.__veatsSeeded) return;
  const email = process.env.ENGINEER_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ENGINEER_SEED_PASSWORD;
  if (!email || !password) {
    g.__veatsSeeded = true;
    return;
  }
  const existing = await repo().getUserByEmail(email);
  if (!existing) {
    await repo().createUser({
      id: randomUUID(),
      name: process.env.ENGINEER_SEED_NAME?.trim() || "Engineer",
      email,
      role: "engineer",
      password_hash: await hashPassword(password),
      active: true,
      created_at: new Date().toISOString(),
    });
  }
  g.__veatsSeeded = true;
}

export async function authenticate(emailIn: string, password: string, ip: string): Promise<{ user: SessionUser; token: string }> {
  const email = emailIn.trim().toLowerCase();
  const key = `${ip}|${email}`;
  throttle(key);
  await ensureSeedEngineer();
  const user = await repo().getUserByEmail(email);
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) {
    failed(key);
    throw new AuthError("Incorrect email or password.", 401);
  }
  attempts.delete(key);
  await repo().touchLogin(user.id);
  const iat = Math.floor(Date.now() / 1000);
  const token = signToken({ uid: user.id, role: user.role, iat, exp: iat + SESSION_TTL_S }, authSecret());
  return { user: toSession(user), token };
}
