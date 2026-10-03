/**
 * Runs the real SQL migrations against an in-process Postgres (PGlite) and exercises approve_project /
 * release_project: approval rules, duplicate approval, release deduction, double release, insufficient
 * stock (nothing deducted), missing material, non-engineer.
 *
 *   npx tsx tests/sql-release.test.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import assert from "node:assert/strict";

const db = new PGlite();
let passed = 0;
const ok = (name: string) => { passed++; console.log(`✓ ${name}`); };
async function expectError(promise: Promise<unknown>, contains: string, name: string) {
  try { await promise; } catch (e) { assert.ok(String((e as Error).message).includes(contains), `${name}: expected "${contains}", got "${(e as Error).message}"`); ok(name); return; }
  assert.fail(`${name}: expected an error containing "${contains}"`);
}

await db.exec("create role service_role; create role anon; create role authenticated;");
await db.exec(readFileSync("supabase/migrations/0001_init.sql", "utf8"));
await db.exec(readFileSync("supabase/migrations/0002_auth_approval_release.sql", "utf8"));
ok("migrations 0001 + 0002 apply");
await db.exec(readFileSync("supabase/migrations/0002_auth_approval_release.sql", "utf8"));
ok("migration 0002 is re-runnable");

const ENG = "11111111-1111-1111-1111-111111111111";
const SALES = "22222222-2222-2222-2222-222222222222";
await db.exec(`
  insert into users (id, name, email, role, active) values ('${ENG}', 'Arben Krasniqi', 'arben@example.com', 'engineer', true), ('${SALES}', 'Sara Sales', 'sara@example.com', 'sales', true);
  insert into products (sku, name, category, unit, purchase_price_eur, selling_price_eur) values ('CABLE', 'Cable', 'c', 'meter', 1, 2), ('BREAKER', 'Circuit breaker', 'c', 'pcs', 1, 2), ('CONNECTOR', 'Connector', 'c', 'pcs', 1, 2);
  insert into inventory (sku, stock_quantity) values ('CABLE', 100), ('BREAKER', 10), ('CONNECTOR', 5);
  insert into projects (id, title, client_name, original_request, status, engineer, cost_settings) values
    ('p1', 'P1', 'C', 'r', 'ENGINEERING_REVIEW', 'x', '{}'),
    ('p2', 'P2', 'C', 'r', 'ENGINEERING_REVIEW', 'x', '{}'),
    ('p3', 'P3', 'C', 'r', 'DRAFT', 'x', '{}');
`);
const stock = async () => Object.fromEntries((await db.query<{ sku: string; stock_quantity: string }>("select sku, stock_quantity from inventory")).rows.map((r) => [r.sku, Number(r.stock_quantity)]));
const status = async (id: string) => (await db.query<{ status: string }>("select status from projects where id = $1", [id])).rows[0].status;
const approve = (id: string, eng = ENG) => db.query("select approve_project($1, $2, 'Arben Krasniqi', 1234.5)", [id, eng]);
const release = (id: string, reqs: object[], actor = ENG) => db.query("select release_project($1, $2::jsonb, $3, 'Arben Krasniqi') as r", [id, JSON.stringify(reqs), actor]);
const REQS = [{ sku: "CABLE", quantity: 10 }, { sku: "BREAKER", quantity: 4 }, { sku: "CONNECTOR", quantity: 2 }];

// ---- approval
await expectError(approve("p1", SALES), "VEATS:NOT_ENGINEER", "a non-engineer cannot approve");
assert.equal(await status("p1"), "ENGINEERING_REVIEW"); ok("failed approval leaves the project untouched");
await expectError(approve("p3"), "VEATS:BAD_STATUS", "a draft project cannot be approved");
await approve("p1");
assert.equal(await status("p1"), "APPROVED");
const row = (await db.query<{ approved_by: string; approved_by_id: string; approved_at: string }>("select approved_by, approved_by_id, approved_at from projects where id='p1'")).rows[0];
assert.equal(row.approved_by, "Arben Krasniqi"); assert.equal(row.approved_by_id, ENG); assert.ok(row.approved_at);
const ap = (await db.query<{ engineer_id: string; status: string; total_eur: string }>("select * from project_approvals where project_id='p1'")).rows;
assert.equal(ap.length, 1); assert.equal(ap[0].engineer_id, ENG); assert.equal(ap[0].status, "APPROVED"); assert.equal(Number(ap[0].total_eur), 1234.5);
ok("approval records engineer id, name, time, status and project");
await expectError(approve("p1"), "VEATS:ALREADY_APPROVED", "duplicate approval is rejected");
assert.equal((await db.query("select 1 from project_approvals where project_id='p1'")).rows.length, 1); ok("still exactly one approval record");
await expectError(db.query("insert into project_approvals (project_id, engineer_name, status) values ('p1', 'x', 'APPROVED')"), "duplicate key", "database itself rejects a second active approval");

// ---- release
await expectError(release("p2", REQS), "VEATS:NOT_APPROVED", "an unapproved project cannot be released");
await expectError(release("p1", REQS, SALES), "VEATS:NOT_ENGINEER", "a non-engineer cannot release");
await expectError(release("p1", []), "VEATS:NO_MATERIALS", "release without materials is rejected");
await expectError(release("p1", [{ sku: "NOPE", quantity: 1 }]), "VEATS:MISSING_MATERIAL:NOPE", "unknown SKU is reported as missing material");
await expectError(release("p1", [{ sku: "CABLE", quantity: 10 }, { sku: "BREAKER", quantity: 11 }]), "VEATS:INSUFFICIENT_STOCK", "insufficient stock is rejected");
assert.deepEqual(await stock(), { CABLE: 100, BREAKER: 10, CONNECTOR: 5 }); ok("a rejected release deducts nothing (all or nothing)");
assert.equal(await status("p1"), "APPROVED"); ok("a rejected release keeps the project approved");

const res = await release("p1", REQS);
assert.deepEqual(await stock(), { CABLE: 90, BREAKER: 6, CONNECTOR: 3 }); ok("release deducts the exact quantities (10 / 4 / 2)");
assert.equal(await status("p1"), "RELEASED"); ok("project is marked RELEASED");
const mv = (await db.query<{ sku: string; quantity_change: string; stock_before: string; stock_after: string; actor_id: string }>("select * from inventory_movements where project_id='p1' order by sku")).rows;
assert.equal(mv.length, 3);
assert.deepEqual(mv.map((m) => [m.sku, Number(m.quantity_change), Number(m.stock_before), Number(m.stock_after)]), [["BREAKER", -4, 10, 6], ["CABLE", -10, 100, 90], ["CONNECTOR", -2, 5, 3]]);
ok("every inventory change is recorded with before/after");
assert.ok(JSON.stringify((res.rows[0] as { r: unknown }).r).includes("movements")); ok("function returns the movements");

await expectError(release("p1", REQS), "VEATS:ALREADY_RELEASED", "releasing again is rejected");
assert.deepEqual(await stock(), { CABLE: 90, BREAKER: 6, CONNECTOR: 3 }); ok("second release does NOT deduct inventory again");
await expectError(db.query("insert into inventory_movements (sku, project_id, quantity_change, stock_before, stock_after, actor_name) values ('CABLE','p1',-1,90,89,'x')"), "duplicate key", "database itself rejects a second deduction of the same SKU for a project");
await expectError(approve("p1"), "VEATS:ALREADY_RELEASED", "a released project cannot be re-approved");
await expectError(db.query("update inventory set stock_quantity = -1 where sku='CABLE'"), "inventory_stock_nonneg", "stock can never go negative");

// ---- concurrency: two releases of the same approved project
await approve("p2");
const results = await Promise.allSettled([release("p2", REQS), release("p2", REQS)]);
assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one concurrent release wins");
assert.deepEqual(await stock(), { CABLE: 80, BREAKER: 2, CONNECTOR: 1 }); ok("two simultaneous releases deduct once");

console.log(`\n${passed} SQL checks passed`);
await db.close();
