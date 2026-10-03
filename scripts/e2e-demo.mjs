// End-to-end check against a running server (real HTTP, real database).
//
//   npm run dev                                   (in another terminal)
//   npm run test:e2e                              (BASE_URL defaults to http://localhost:3000)
//
// Needs an engineer account: ENGINEER_SEED_EMAIL / ENGINEER_SEED_PASSWORD from .env.local, or E2E_EMAIL / E2E_PASSWORD.
// Creates (or reuses) a non-engineer account "e2e-sales@veats.local" through scripts/create-user.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEMO = "Design a control panel for 3 motors rated at 15 kW each at 400V.";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failures++;
};
const section = (t) => console.log(`\n— ${t}`);

// ---- credentials from .env.local (never printed)
const env = {};
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; }
const ENG_EMAIL = process.env.E2E_EMAIL || env.ENGINEER_SEED_EMAIL;
const ENG_PASSWORD = process.env.E2E_PASSWORD || env.ENGINEER_SEED_PASSWORD;
if (!ENG_EMAIL || !ENG_PASSWORD) { console.error("Set ENGINEER_SEED_EMAIL / ENGINEER_SEED_PASSWORD in .env.local (or E2E_EMAIL / E2E_PASSWORD)."); process.exit(2); }
const SALES_EMAIL = "e2e-sales@veats.local";
const SALES_PASSWORD = "e2e-Sales-Password-1";

// ---- tiny HTTP client with a cookie jar
function client() {
  let cookie = "";
  const send = async (method, path, body, init = {}) => {
    const headers = { ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) };
    const res = await fetch(BASE + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, redirect: init.redirect ?? "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const [k, v] = pair.split("="); cookie = v ? `${k}=${v}` : ""; }
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : init.text ? await res.text() : null;
    return { status: res.status, data, headers: res.headers, res };
  };
  return { get: (p, i) => send("GET", p, undefined, i), post: (p, b, i) => send("POST", p, b ?? {}, i), form: (p, f) => send("POST", p, f), has: () => !!cookie };
}

// ================================================================== authentication
section("Authentication");
const anon = client();
let r = await anon.get("/api/projects");
ok(r.status === 401 && r.data?.code === "UNAUTHENTICATED", "API without a session → 401");
r = await anon.get("/dashboard");
ok([302, 307, 308].includes(r.status) && (r.headers.get("location") ?? "").includes("/login"), "protected page redirects to /login");
r = await anon.get("/projects");
ok([302, 307, 308].includes(r.status), "projects page is protected");
r = await anon.post("/api/auth/login", { email: ENG_EMAIL, password: "definitely-wrong" });
ok(r.status === 401 && !anon.has(), "wrong password → 401, no session");
r = await anon.get("/login", { text: true });
ok(r.status === 200, "login page is public");
r = await anon.post("/api/projects", { request: DEMO }, { headers: { origin: "http://evil.example" } });
ok(r.status === 403, "cross-site POST is blocked");

const eng = client();
r = await eng.post("/api/auth/login", { email: ENG_EMAIL, password: ENG_PASSWORD });
ok(r.status === 200 && r.data.user?.role === "engineer", "engineer signs in");
const ENGINEER = r.data.user;
r = await eng.get("/api/auth/me");
ok(r.status === 200 && r.data.user.id === ENGINEER.id, "session identifies the engineer");

if (!process.env.VEATS_DATA_DIR) { console.error("Refusing to run: set VEATS_DATA_DIR to the throw-away data folder the server under test uses (e.g. .data-e2e). This test releases projects and would change real inventory."); process.exit(2); }
try { execFileSync("node", ["scripts/create-user.mjs", "--email", SALES_EMAIL, "--name", "E2E Sales", "--role", "sales", "--password", SALES_PASSWORD], { stdio: "pipe" }); } catch (e) { console.error(String(e.stderr)); }
const sales = client();
r = await sales.post("/api/auth/login", { email: SALES_EMAIL, password: SALES_PASSWORD });
ok(r.status === 200 && r.data.user?.role === "sales", "non-engineer account can sign in (role: sales)");

// ================================================================== motor panel flow, approval, release
section("Project approval");
const inventory = async () => Object.fromEntries((await eng.get("/api/inventory")).data.map((p) => [p.sku, p.stock_quantity]));

r = await eng.post("/api/projects", { request: DEMO, client_name: "E2E Manufacturing", mode: "rule_based" });
ok(r.status === 200 && r.data.analysis.motors[0]?.quantity === 3, "request analysed → project created");
let p = r.data;
ok(p.engineer === ENGINEER.name, "project creator is recorded as the engineer");
r = await eng.post(`/api/projects/${p.id}/approve`);
ok(r.status === 409, "cannot approve before a design exists");
r = await eng.post(`/api/projects/${p.id}/design`, { patch: { starting_method: "DOL", cable_length_m: 30, environment: "indoor_dusty" } });
ok(r.status === 200 && r.data.status === "ENGINEERING_REVIEW", "design generated → pending approval");
p = r.data;

r = await eng.post(`/api/projects/${p.id}/review`, { type: "add_note", text: "Reviewed by e2e." });
ok(r.status === 200 && r.data.notes.at(-1).author === ENGINEER.name, "notes carry the signed-in engineer's name");
r = await eng.post(`/api/projects/${p.id}/approve`);
ok(r.status === 409 && /critical/i.test(r.data.error), "approval blocked while critical warnings are open");
for (const w of p.design.calculation.warnings.filter((w) => w.severity === "critical")) await eng.post(`/api/projects/${p.id}/review`, { type: "ack_warning", warning_id: w.id, acknowledged: true });

r = await anon.post(`/api/projects/${p.id}/approve`);
ok(r.status === 401, "approve without signing in → 401");
r = await sales.post(`/api/projects/${p.id}/approve`);
ok(r.status === 403 && r.data.code === "FORBIDDEN", "non-engineer cannot approve → 403");
r = await eng.get(`/api/projects/${p.id}`);
ok(r.data.status === "ENGINEERING_REVIEW" && !r.data.approved_by, "a refused approval changes nothing");

r = await eng.post(`/api/projects/${p.id}/approve`);
ok(r.status === 200 && r.data.status === "APPROVED", "engineer approves");
ok(r.data.approved_by === ENGINEER.name && r.data.approved_by_id === ENGINEER.id && !!r.data.approved_at, "approval stores engineer id, name and timestamp");
r = await eng.get(`/api/projects/${p.id}`);
ok(r.data.status === "APPROVED" && r.data.approved_by === ENGINEER.name, "approval persists after reload (read back from the database)");
r = await eng.get(`/api/projects/${p.id}/approvals`);
ok(r.data.length === 1 && r.data[0].status === "APPROVED" && r.data[0].engineer_id === ENGINEER.id && r.data[0].project_id === p.id, "approval record: engineer id, project id, status");
r = await eng.post(`/api/projects/${p.id}/approve`);
ok(r.status === 409 && r.data.code === "ALREADY_APPROVED", "duplicate approval is rejected (clear message)");
r = await eng.get(`/api/projects/${p.id}/approvals`);
ok(r.data.length === 1, "still exactly one approval record");

section("Inventory release");
r = await sales.post(`/api/projects/${p.id}/release`);
ok(r.status === 403, "non-engineer cannot release");
r = await eng.get(`/api/projects/${p.id}/release`);
const preview = r.data;
ok(r.status === 200 && preview.lines.length > 5, `release preview lists ${preview.lines?.length} stocked materials`);

// make one line need more than the warehouse has → release must fail without touching anything
const stocked = p.design.bom.filter((l) => l.sku && l.quantity > 0);
const target = stocked.find((l) => l.id.endsWith("contactor")) ?? stocked[0];
r = await eng.post(`/api/projects/${p.id}/review`, { type: "bom_override", line_id: target.id, override: { quantity: 99999 } });
ok(r.status === 200 && r.data.status === "ENGINEERING_REVIEW" && !r.data.approved_by, "editing an approved design revokes the approval");
r = await eng.get(`/api/projects/${p.id}/approvals`);
ok(r.data.some((a) => a.status === "REVOKED"), "revoked approval is kept in the history");
r = await eng.post(`/api/projects/${p.id}/release`);
ok(r.status === 409 && r.data.code === "NOT_APPROVED", "an unapproved project cannot be released");
r = await eng.get(`/api/projects/${p.id}`);
for (const w of r.data.design.calculation.warnings.filter((w) => w.severity === "critical" && !w.acknowledged)) await eng.post(`/api/projects/${p.id}/review`, { type: "ack_warning", warning_id: w.id, acknowledged: true });
r = await eng.post(`/api/projects/${p.id}/approve`);
ok(r.status === 200, "re-approved after the edit (new critical warnings acknowledged)");
const before = await inventory();
r = await eng.post(`/api/projects/${p.id}/release`);
ok(r.status === 409 && r.data.code === "INSUFFICIENT_STOCK" && /Nothing was deducted/.test(r.data.error), "insufficient stock → clear 409, nothing deducted");
ok(JSON.stringify(await inventory()) === JSON.stringify(before), "inventory is unchanged after the failed release");
r = await eng.get(`/api/projects/${p.id}`);
ok(r.data.status === "APPROVED", "project stays approved after the failed release");

r = await eng.post(`/api/projects/${p.id}/review`, { type: "bom_override", line_id: target.id, override: null });
for (const w of r.data.design.calculation.warnings.filter((w) => w.severity === "critical" && !w.acknowledged)) await eng.post(`/api/projects/${p.id}/review`, { type: "ack_warning", warning_id: w.id, acknowledged: true });
r = await eng.post(`/api/projects/${p.id}/approve`);
ok(r.status === 200, "quantity corrected and re-approved");
r = await eng.get(`/api/projects/${p.id}/release`);
const plan1 = r.data;
const stock0 = await inventory();
r = await eng.post(`/api/projects/${p.id}/release`);
ok(r.status === 200 && r.data.project.status === "RELEASED" && r.data.movements.length === plan1.lines.length, "release succeeds → RELEASED with one movement per SKU");
ok(r.data.project.released_by === ENGINEER.name && !!r.data.project.released_at, "release records who and when");
const stock1 = await inventory();
const exact = plan1.lines.every((l) => Math.abs(stock1[l.sku] - (stock0[l.sku] - l.required)) < 1e-6);
ok(exact, `inventory deducted by the exact quantities (${plan1.lines.slice(0, 3).map((l) => `${l.sku} −${l.required}`).join(", ")} …)`);
const moves = (await eng.get(`/api/inventory/movements?project_id=${p.id}`)).data;
ok(moves.length === plan1.lines.length && moves.every((m) => m.quantity_change < 0 && m.stock_after === m.stock_before + m.quantity_change), "every change is recorded in the movement log");
r = await eng.post(`/api/projects/${p.id}/release`);
ok(r.status === 409 && r.data.code === "ALREADY_RELEASED", "releasing again is rejected");
ok(JSON.stringify(await inventory()) === JSON.stringify(stock1), "second release did NOT deduct inventory again");
r = await eng.post(`/api/projects/${p.id}/review`, { type: "add_note", text: "late edit" });
ok(r.status === 409 && r.data.code === "LOCKED", "a released project is locked against edits");

// ================================================================== plan upload → electrical plan → CAD
section("AutoCAD plan: upload, analysis, electrical plan, CAD file");
const sample = readFileSync("data/samples/office-floor.dxf");
const upload = (name, bytes, extra = {}) => { const f = new FormData(); f.set("file", new Blob([bytes]), name); for (const [k, v] of Object.entries(extra)) f.set(k, v); return eng.form("/api/plans", f); };
r = await upload("notes.txt", Buffer.from("hello"));
ok(r.status === 415, "unsupported file type is rejected (415)");
r = await upload("empty.dxf", Buffer.alloc(0));
ok(r.status === 422, "empty file is rejected");
r = await upload("broken.dxf", Buffer.from("this is not a drawing at all"));
ok(r.status === 422 && /DXF/i.test(r.data.error), "invalid DXF is rejected with a clear message");
r = await upload("fake.dwg", Buffer.from("not really a dwg file"));
ok(r.status === 422 && r.data.code === "INVALID_DWG", "invalid DWG header is rejected");
r = await anon.form("/api/plans", (() => { const f = new FormData(); f.set("file", new Blob([sample]), "office.dxf"); return f; })());
ok(r.status === 401, "upload requires sign-in");

r = await upload("office-floor.dxf", sample, { client_name: "Alba Offices", title: "Office floor — electrical plan" });
ok(r.status === 200 && r.data.plan?.analysis, "valid DXF uploaded and analysed");
let pp = r.data;
const an = pp.plan.analysis;
ok(an.rooms.length === 9 && an.scale.unit === "mm" && an.confidence === "high", `analysis: ${an.rooms.length} rooms, scale ${an.scale.unit} (${an.scale.source}), confidence ${an.confidence}`);
ok(an.openings.filter((o) => o.type === "door").length === 9 && an.openings.filter((o) => o.type === "window").length === 7, "analysis: 9 doors (with swing direction) and 7 windows");
ok(an.openings.some((o) => o.exterior && o.type === "door") && an.walls.some((w) => w.exterior) && an.walls.some((w) => !w.exterior), "analysis: exterior and interior walls distinguished");
ok(an.rooms.some((x) => x.name === "KITCHEN" && x.type === "kitchen") && an.rooms.every((x) => x.area_m2 > 5), "analysis: room names, functions and areas");
ok(pp.status === "IN_PROGRESS" && pp.plan.electrical === null, "project is In progress until the electrical plan exists");

r = await eng.post(`/api/projects/${pp.id}/plan/cad`);
ok(r.status === 409, "CAD cannot be generated before the electrical plan");
r = await eng.post(`/api/projects/${pp.id}/plan/electrical`, { sockets: true, supply: "auto" });
ok(r.status === 200 && r.data.plan.electrical.circuits.length >= 10 && r.data.status === "ENGINEERING_REVIEW", "electrical plan generated → pending approval");
pp = r.data;
const el = pp.plan.electrical;
ok(el.devices.some((d) => d.kind === "luminaire") && el.devices.some((d) => d.kind === "switch") && el.devices.some((d) => d.kind === "socket") && el.devices.some((d) => d.kind === "special_socket") && el.panel.kind === "panel", "electrical plan: luminaires, switches, sockets, special sockets, panel");
ok(el.circuits.every((c) => c.route.length >= 2 && c.length_m > 0 && /^C\d+$/.test(c.id) && c.design_current_a <= Number(/(\d+) A/.exec(c.protection)?.[1] ?? 999)), "every circuit has a label, a routed cable and a design current within its protection");
const roomOf = Object.fromEntries(an.rooms.map((x) => [x.id, x]));
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
ok(el.devices.filter((d) => d.room_id && d.kind !== "panel" && !d.description.startsWith("Outdoor")).every((d) => inside(d.at, roomOf[d.room_id].polygon)), "devices are placed inside their rooms (real geometry)");
ok(el.legend.length >= 5 && el.technical.standards.length > 0 && el.assumptions.length > 0 && el.bom.length > 8, "legend, technical data, assumptions and bill of materials present");

r = await eng.post(`/api/projects/${pp.id}/plan/cad`);
ok(r.status === 409 && r.data.code === "REVIEW_REQUIRED", "CAD requires the engineer's review confirmation first");
r = await sales.post(`/api/projects/${pp.id}/plan/review`);
ok(r.status === 403, "non-engineer cannot confirm the plan review");
r = await eng.post(`/api/projects/${pp.id}/plan/review`);
ok(r.status === 200 && r.data.plan.reviewed_by === ENGINEER.name, "engineer confirms the review");
r = await eng.post(`/api/projects/${pp.id}/plan/cad`);
ok(r.status === 200 && r.data.plan.cad?.entities > 300 && existsSync(r.data.plan.cad.saved_path), "CAD file generated on disk");
pp = r.data;
r = await eng.get(`/api/projects/${pp.id}/plan/cad`, { text: true });
ok(r.status === 200 && (r.headers.get("content-disposition") ?? "").includes(".dxf") && r.data.includes("E-LIGHT") && r.data.includes("A-WALL") && r.data.includes("EOF"), "CAD download: original layers + electrical layers");

if (process.env.E2E_OPEN_AUTOCAD === "1") {
  r = await eng.post(`/api/projects/${pp.id}/plan/open`);
  ok(r.status === 200 && r.data.plan.cad.opened_at, `Open in AutoCAD → ${r.data?.plan?.cad?.open_method}`);
}

// ---- plan project: approve + concurrent release deducts once
section("Plan project: approval and concurrent release");
r = await eng.post(`/api/projects/${pp.id}/approve`);
ok(r.status === 200 && r.data.approved_by === ENGINEER.name, "plan project approved by the engineer");
const prev = (await eng.get(`/api/projects/${pp.id}/release`)).data;
ok(prev.lines.length > 5 && prev.can_release && prev.unstocked.length > 0, `release preview: ${prev.lines.length} stocked lines, ${prev.unstocked.length} items to purchase (not deducted)`);
const s0 = await inventory();
const results = await Promise.all(Array.from({ length: 6 }, () => eng.post(`/api/projects/${pp.id}/release`)));
ok(results.filter((x) => x.status === 200).length === 1 && results.filter((x) => x.status === 409).length === 5, "6 simultaneous release requests → exactly one succeeds");
const s1 = await inventory();
ok(prev.lines.every((l) => Math.abs(s1[l.sku] - (s0[l.sku] - l.required)) < 1e-6), "inventory deducted exactly once for the concurrent requests");
ok((await eng.get(`/api/inventory/movements?project_id=${pp.id}`)).data.length === prev.lines.length, "one movement per SKU recorded");

// ================================================================== pages
section("Pages");
const pages = ["/", "/login", "/dashboard", "/projects", `/projects/${p.id}`, `/projects/${pp.id}`, `/projects/${p.id}/quote`, "/inventory", "/quotes", "/standards", "/about", "/requests"];
for (const path of pages) {
  const c = path === "/" || path === "/login" ? anon : eng;
  const res = await c.get(path, { text: true });
  ok(res.status === 200, `GET ${path} → ${res.status}`);
}
r = await eng.get("/settings", { text: true });
ok(r.status === 404, "/settings is gone (404)");
r = await eng.get("/api/admin/seed", { text: true });
ok(r.status === 200, "seed SQL export still available");
r = await eng.post("/api/admin/seed");
ok(r.status === 405, "destructive re-seed endpoint removed (405)");
r = await eng.get("/projects/new");
ok([307, 308].includes(r.status), "/projects/new redirects to the requests portal");
const rq = (await eng.get("/requests", { text: true })).data;
ok(!/AI Type/i.test(rq), "Requests Portal has no AI Type field");
r = await eng.get(`/api/projects/${p.id}/dxf`, { text: true });
ok(r.status === 200, "DXF download");

section("Sign out");
r = await eng.post("/api/auth/logout");
ok(r.status === 200, "logout");
r = await eng.get("/api/projects");
ok(r.status === 401, "API is closed after logout");

console.log(`\nProjects: ${BASE}/projects/${p.id} · ${BASE}/projects/${pp.id}`);
console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
