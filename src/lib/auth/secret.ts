import { randomBytes } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { dataDir } from "../data-dir";

let cached: string | null = null;

/**
 * Secret used to sign session cookies. Production must set AUTH_SECRET.
 * In development a random secret is generated once and kept in .data/auth-secret (git-ignored).
 */
export function authSecret(): string {
  if (cached) return cached;
  const env = process.env.AUTH_SECRET;
  if (env && env.length >= 16) return (cached = env);
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (at least 16 characters) in production.");
  const file = path.join(dataDir(), "auth-secret");
  try {
    cached = readFileSync(file, "utf8").trim();
    if (cached.length >= 32) return cached;
  } catch {
    // generate below
  }
  cached = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, cached, { mode: 0o600 });
  return cached;
}
