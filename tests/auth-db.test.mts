/**
 * Authentication primitives and the local database's atomic approve / release.
 *   npx tsx --conditions=react-server tests/auth-db.test.mts
 * Uses a throw-away data folder (never touches .data).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "veats-test-"));
process.env.VEATS_DATA_DIR = dir;
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";

const { hashPassword, verifyPassword } = await import("../src/lib/auth/password");
const { signToken, verifyToken } = await import("../src/lib/auth/token");
const { repo, RepoError } = await import("../src/lib/db");
type Project = import("../src/lib/types").Project;

let n = 0;
const ok = (name: string) => { n++; console.log(`✓ ${name}`); };
async function rejects(p: Promise<unknown>, code: string, name: string) {
  try { await p; } catch (e) { assert.ok(e instanceof RepoError && e.code === code, `${name}: expected ${code}, got ${e instanceof RepoError ? e.code : e}`); ok(name); return e as InstanceType<typeof RepoError>; }
  assert.fail(`${name}: expected ${code}`);
}

// ---------------------------------------------------------------- passwords + tokens
const h = await hashPassword("correct horse battery staple");
assert.ok(h.startsWith("scrypt$16384$8$1$"));
assert.equal(await verifyPassword("correct horse battery staple", h), true); ok("password verifies");
assert.equal(await verifyPassword("wrong", h), false); ok("wrong password is rejected");
assert.equal(await verifyPassword("x", "garbage"), false); assert.equal(await verifyPassword("x", null), false); ok("malformed hash never throws");
assert.notEqual(h, await hashPassword("correct horse battery staple")); ok("hashes are salted");

const secret = "s".repeat(32);
const now = Math.floor(Date.now() / 1000);
const tok = signToken({ uid: "u1", role: "engineer", iat: now, exp: now + 60 }, secret);
assert.equal(verifyToken(tok, secret)?.uid, "u1"); ok("valid token verifies");
assert.equal(verifyToken(tok, "x".repeat(32)), null); ok("token signed with another secret is rejected");
assert.equal(verifyToken(tok.slice(0, -2) + "xx", secret), null); ok("tampered signature is rejected");
const forged = Buffer.from(JSON.stringify({ uid: "u1", role: "admin", iat: now, exp: now + 60 })).toString("base64url") + "." + tok.split(".")[1];
assert.equal(verifyToken(forged, secret), null); ok("tampered payload is rejected");
assert.equal(verifyToken(signToken({ uid: "u1", role: "engineer", iat: now - 100, exp: now - 10 }, secret), secret), null); ok("expired token is rejected");
assert.equal(verifyToken(undefined, secret), null); assert.equal(verifyToken("abc", secret), null); ok("missing / malformed token is rejected");

// ---------------------------------------------------------------- database
const db = repo();
assert.equal(db.backend, "local");
const eng = { id: randomUUID(), name: "Arben Krasniqi", email: "arben@x.test", role: "engineer" as const, password_hash: h, active: true, created_at: new Date().toISOString() };
const sales = { ...eng, id: randomUUID(), name: "Sara", email: "sara@x.test", role: "sales" as const };
await db.createUser(eng); await db.createUser(sales);
await rejects(db.createUser({ ...eng, id: randomUUID() }), "DATABASE", "duplicate email is rejected");
assert.equal((await db.getUserByEmail("ARBEN@x.test"))?.id, eng.id); ok("users are found by email (case-insensitive)");

const products = await db.listProducts();
const stock = async () => Object.fromEntries((await db.listProducts()).map((p) => [p.sku, p.stock_quantity]));
const S0 = await stock();
const base = (id: string, status: Project["status"]): Project => ({
  id, title: id, client_name: "c", original_request: "r", status, engineer: "x", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  analysis: null, inputs: null, cost_settings: { labor_rate_eur_h: 1, labor_hours: { value: 1, provenance: "ASSUMED_VALUE" }, engineering_rate_eur_h: 1, engineering_hours: { value: 1, provenance: "ASSUMED_VALUE" }, margin_pct: 10 },
  bom_overrides: {}, custom_lines: [], acknowledged_warnings: {}, notes: [], history: [], design: null,
});
const NOW = () => new Date().toISOString();
const reqs = (m: Record<string, number>) => Object.entries(m).map(([sku, quantity]) => ({ sku, name: sku, quantity, unit: "pcs", source: "plan" as const }));
const CABLE = "CABL-NYY-5X6", MCB = "PROT-MCB-002", CONN = "CONN-WAG-221";
assert.ok(products.some((p) => p.sku === CABLE) && S0[CABLE] >= 10);

await db.saveProject(base("a1", "ENGINEERING_REVIEW"));
await db.saveProject(base("a2", "DRAFT"));
await rejects(db.approveProject({ project_id: "a1", engineer: sales, now: NOW(), total_eur: 1 }), "NOT_ENGINEER", "a non-engineer cannot approve");
await rejects(db.approveProject({ project_id: "a2", engineer: eng, now: NOW(), total_eur: 1 }), "BAD_STATUS", "a draft cannot be approved");
await rejects(db.approveProject({ project_id: "zz", engineer: eng, now: NOW(), total_eur: 1 }), "NOT_FOUND", "unknown project");
await rejects(db.approveProject({ project_id: "a1", engineer: eng, now: NOW(), total_eur: 1, validate: () => { throw new RepoError("DATABASE", "validation failed"); } }), "DATABASE", "a failing validation aborts the approval");
assert.equal((await db.getProject("a1"))?.status, "ENGINEERING_REVIEW"); ok("an aborted approval changes nothing");

const t0 = NOW();
const { project: ap, approval } = await db.approveProject({ project_id: "a1", engineer: eng, now: t0, total_eur: 99.5 });
assert.equal(ap.status, "APPROVED"); assert.equal(ap.approved_by, eng.name); assert.equal(ap.approved_by_id, eng.id); assert.equal(ap.approved_at, t0);
assert.equal(approval.engineer_id, eng.id); assert.equal(approval.status, "APPROVED"); assert.equal(approval.total_eur, 99.5);
ok("approval stores engineer id, name, project, time, status");
const reread = await db.getProject("a1");
assert.equal(reread?.approved_by, eng.name); assert.equal((await db.listApprovals("a1")).length, 1); ok("approval is persisted (re-read from disk)");
await rejects(db.approveProject({ project_id: "a1", engineer: eng, now: NOW(), total_eur: 1 }), "ALREADY_APPROVED", "duplicate approval is rejected");
assert.equal((await db.listApprovals("a1")).length, 1); ok("still one approval record");
await db.revokeApprovals("a1", "edited", NOW());
assert.equal((await db.listApprovals("a1"))[0].status, "REVOKED"); ok("revoked approvals are kept in the history");

// ---- release
await db.saveProject(base("r1", "APPROVED"));
await db.saveProject({ ...base("r0", "ENGINEERING_REVIEW") });
await rejects(db.releaseProject({ project_id: "r0", actor: eng, now: NOW(), requirements: reqs({ [CABLE]: 1 }) }), "NOT_APPROVED", "unapproved project cannot be released");
await rejects(db.releaseProject({ project_id: "r1", actor: sales, now: NOW(), requirements: reqs({ [CABLE]: 1 }) }), "NOT_ENGINEER", "non-engineer cannot release");
await rejects(db.releaseProject({ project_id: "r1", actor: eng, now: NOW(), requirements: [] }), "NO_MATERIALS", "release without materials is rejected");
await rejects(db.releaseProject({ project_id: "r1", actor: eng, now: NOW(), requirements: reqs({ NOPE: 1, [CABLE]: 1 }) }), "MISSING_MATERIAL", "unknown SKU is reported");
const short = await rejects(db.releaseProject({ project_id: "r1", actor: eng, now: NOW(), requirements: reqs({ [CABLE]: 10, [MCB]: S0[MCB] + 1 }) }), "INSUFFICIENT_STOCK", "insufficient stock is rejected");
assert.ok(JSON.stringify(short.details).includes(MCB));
assert.deepEqual(await stock(), S0); ok("rejected releases deduct nothing (all or nothing)");
assert.equal((await db.getProject("r1"))?.status, "APPROVED"); ok("rejected release keeps the project approved");

const out = await db.releaseProject({ project_id: "r1", actor: eng, now: NOW(), requirements: reqs({ [CABLE]: 10, [MCB]: 4, [CONN]: 2 }) });
const S1 = await stock();
assert.equal(S1[CABLE], S0[CABLE] - 10); assert.equal(S1[MCB], S0[MCB] - 4); assert.equal(S1[CONN], S0[CONN] - 2); ok("exact quantities deducted (10 / 4 / 2)");
assert.equal(out.project.status, "RELEASED"); assert.equal(out.project.released_by, eng.name); assert.equal(out.movements.length, 3);
assert.deepEqual(out.movements.map((m) => [m.sku, m.quantity_change, m.stock_before - 0, m.stock_after]).sort(), [[CABLE, -10, S0[CABLE], S0[CABLE] - 10], [CONN, -2, S0[CONN], S0[CONN] - 2], [MCB, -4, S0[MCB], S0[MCB] - 4]].sort());
ok("every change recorded with before / after");
await rejects(db.releaseProject({ project_id: "r1", actor: eng, now: NOW(), requirements: reqs({ [CABLE]: 10 }) }), "ALREADY_RELEASED", "second release is rejected");
assert.deepEqual(await stock(), S1); ok("second release did not deduct again");
await rejects(db.approveProject({ project_id: "r1", engineer: eng, now: NOW(), total_eur: 1 }), "ALREADY_RELEASED", "a released project cannot be approved again");

// ---- concurrency: 25 simultaneous releases of one project, then 25 of different projects fighting for scarce stock
await db.saveProject(base("c1", "APPROVED"));
const res = await Promise.allSettled(Array.from({ length: 25 }, () => db.releaseProject({ project_id: "c1", actor: eng, now: NOW(), requirements: reqs({ [CABLE]: 5 }) })));
assert.equal(res.filter((r) => r.status === "fulfilled").length, 1); ok("25 simultaneous releases of the same project → exactly one succeeds");
assert.equal((await stock())[CABLE], S1[CABLE] - 5); ok("…and the stock was deducted exactly once");

const scarce = (await stock())[CABLE];
const need = Math.floor(scarce / 4) + 1; // four projects fit, the fifth does not
for (let i = 0; i < 6; i++) await db.saveProject(base(`s${i}`, "APPROVED"));
const fight = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => db.releaseProject({ project_id: `s${i}`, actor: eng, now: NOW(), requirements: reqs({ [CABLE]: need }) })));
const won = fight.filter((r) => r.status === "fulfilled").length;
const after = (await stock())[CABLE];
assert.equal(won, Math.floor(scarce / need)); assert.equal(after, scarce - won * need); assert.ok(after >= 0);
ok(`6 projects competing for scarce stock → ${won} succeed, stock never goes negative (${after} left)`);

assert.deepEqual((await db.listMovements({ project_id: "r1" })).length, 3); ok("movement log is queryable per project");

rmSync(dir, { recursive: true, force: true });
console.log(`\n${n} auth / database checks passed`);
