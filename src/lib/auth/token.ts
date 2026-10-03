import { createHmac, timingSafeEqual } from "crypto";
import type { UserRole } from "../types";

/**
 * Signed session token: base64url(payload) "." base64url(HMAC-SHA256(payload)).
 * The token only carries the user id and an expiry; role and active-state are always re-read from the
 * database, so deactivating an account or changing its role takes effect immediately.
 */

export interface SessionPayload {
  uid: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export const SESSION_COOKIE = "veats_session";
export const SESSION_TTL_S = 8 * 60 * 60;

const b64 = (b: Buffer) => b.toString("base64url");

export function signToken(payload: SessionPayload, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;
}

export function verifyToken(token: string | undefined | null, secret: string, nowS = Math.floor(Date.now() / 1000)): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof p.uid !== "string" || typeof p.exp !== "number" || p.exp <= nowS) return null;
    return p;
  } catch {
    return null;
  }
}
