// Creates (or updates the password of) a user account.
//
//   node scripts/create-user.mjs --email arben@company.com --name "Arben Krasniqi" --role engineer [--password ...]
//
// With no --password a random one is generated and printed once. Roles: engineer | sales | admin.
// Writes to Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (in the environment or .env.local),
// otherwise to the local database (.data/db.json). Password hash format = src/lib/auth/password.ts (scrypt).
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : acc), []));
const email = args.email?.trim().toLowerCase();
const name = args.name?.trim();
const role = args.role ?? "engineer";
if (!email || !name || !["engineer", "sales", "admin"].includes(role)) {
  console.error('Usage: node scripts/create-user.mjs --email <email> --name "<Full Name>" --role engineer|sales|admin [--password <pw>]');
  process.exit(1);
}
const password = args.password && args.password !== "true" ? args.password : randomBytes(9).toString("base64url");
if (password.length < 10) { console.error("Password must be at least 10 characters."); process.exit(1); }

function loadEnvFile() {
  const f = join(process.cwd(), ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile();

const hash = await new Promise((resolve, reject) => {
  const salt = randomBytes(16);
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(`scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`)));
});

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: existing } = await sb.from("users").select("id").ilike("email", email).maybeSingle();
  const { error } = existing
    ? await sb.from("users").update({ name, role, password_hash: hash, active: true }).eq("id", existing.id)
    : await sb.from("users").insert({ id: randomUUID(), name, email, role, password_hash: hash, active: true });
  if (error) { console.error("Database error:", error.message); process.exit(1); }
  console.log(`${existing ? "Updated" : "Created"} ${role} ${email} in Supabase.`);
} else {
  const file = join(process.env.VEATS_DATA_DIR || join(process.cwd(), ".data"), "db.json");
  mkdirSync(dirname(file), { recursive: true });
  const db = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { products: [], projects: [], quotes: [], reviews: [] };
  db.users ??= [];
  const i = db.users.findIndex((u) => u.email.toLowerCase() === email);
  const rec = { id: i >= 0 ? db.users[i].id : randomUUID(), name, email, role, password_hash: hash, active: true, created_at: i >= 0 ? db.users[i].created_at : new Date().toISOString() };
  if (i >= 0) db.users[i] = rec; else db.users.push(rec);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file);
  console.log(`${i >= 0 ? "Updated" : "Created"} ${role} ${email} in the local database.`);
}
if (!args.password) console.log(`Password: ${password}`);
