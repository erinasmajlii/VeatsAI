// End-to-end demo check against a running server.
// Usage: npm run dev  (in another terminal), then: npm run test:e2e  [BASE_URL=http://localhost:3000]
const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEMO = "Design a control panel for 3 motors rated at 15 kW each at 400V.";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "✓" : "✕"} ${msg}`);
  if (!cond) failures++;
};

async function post(path, body) {
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, data: await res.json() };
}

// 1. AI understanding → structured JSON + missing information
let { status, data: p } = await post("/api/projects", { request: DEMO, client_name: "Demo Manufacturing Sh.p.k." });
ok(status === 200, `project created (${p.analysis?.source})`);
ok(p.analysis.motors[0]?.quantity === 3 && p.analysis.motors[0]?.power_kw === 15, "AI: 3 × 15 kW motors");
ok(p.analysis.voltage === 400, "AI: 400 V");
ok(p.status === "MISSING_INFORMATION" && p.analysis.missing_information.includes("starting_method"), "system identifies missing information (starting method)");

// 2. Cannot design without critical info
({ status } = await post(`/api/projects/${p.id}/design`, {}));
ok(status === 400, "design blocked while critical info is missing (Insufficient engineering data)");

// 3. User provides missing data → engineering → standards → BOM → inventory → cost → CAD
({ status, data: p } = await post(`/api/projects/${p.id}/design`, { patch: { starting_method: "DOL", cable_length_m: 30, environment: "indoor_dusty" } }));
ok(status === 200 && p.status === "ENGINEERING_REVIEW", "design generated → ENGINEERING_REVIEW");
const flc = p.design.calculation.results.find((r) => r.id.endsWith(".flc"));
ok(flc && Math.abs(flc.numeric - 28.3) < 0.1, `current calculated deterministically: ${flc?.value}`);
ok(p.design.calculation.results.every((r) => r.standards.length && r.rule_id), "every result has rule + standard reference");
ok(p.design.bom.length > 10, `BOM generated (${p.design.bom.length} lines)`);
ok(p.design.bom.some((l) => l.stock_status === "UNAVAILABLE"), "inventory check flags unavailable component");
ok(p.design.cost.total > 0, `cost calculated: €${p.design.cost.total}`);
ok(p.design.cad?.svg.startsWith("<svg") && p.design.cad.dxf.includes("ENTITIES"), "CAD SVG + DXF generated");

// 4. Engineer edits
({ data: p } = await post(`/api/projects/${p.id}/review`, { type: "cost_settings", settings: { margin_pct: 25 } }));
ok(p.design.cost.margin_pct === 25, "engineer edits margin → 25 %");
({ data: p } = await post(`/api/projects/${p.id}/review`, { type: "bom_override", line_id: "M1.contactor", override: { quantity: 4 } }));
ok(p.design.bom.find((l) => l.id === "M1.contactor").quantity === 4, "engineer edits component quantity");
({ data: p } = await post(`/api/projects/${p.id}/review`, { type: "update_inputs", patch: { power_factor: 0.86, efficiency: 0.91 } }));
ok(p.inputs.power_factor.provenance === "ENGINEER_OVERRIDE", "engineer edits calculation inputs (PF/η) → recalculated");
({ data: p } = await post(`/api/projects/${p.id}/review`, { type: "add_note", text: "Overload relay 23–32 A to be ordered from supplier." }));
ok(p.notes.length === 1, "engineering note added");

// 5. Approval blocked until critical warnings acknowledged
({ status } = await post(`/api/projects/${p.id}/approve`));
ok(status === 409, "approval blocked by unacknowledged critical warnings");
for (const w of p.design.calculation.warnings.filter((w) => w.severity === "critical")) {
  ({ data: p } = await post(`/api/projects/${p.id}/review`, { type: "ack_warning", warning_id: w.id, acknowledged: true }));
}
({ status, data: p } = await post(`/api/projects/${p.id}/approve`));
ok(status === 200 && p.status === "APPROVED", "engineer approves → APPROVED");

// 6. Quote
const { data: q } = await post("/api/quotes/generate", { project_id: p.id });
ok(q.status === "ISSUED", `quote ${q.quote_number} issued (€${q.total})`);

// 7. Pages render
for (const path of ["/", "/projects", "/projects/new", `/projects/${p.id}`, `/projects/${p.id}/quote`, "/inventory", "/quotes", "/standards", "/settings"]) {
  const res = await fetch(BASE + path);
  ok(res.status === 200, `GET ${path} → ${res.status}`);
}
const dxf = await fetch(`${BASE}/api/projects/${p.id}/dxf`);
ok(dxf.status === 200, "DXF download");

console.log(`\nProject: ${BASE}/projects/${p.id}`);
console.log(failures ? `${failures} check(s) FAILED` : "All checks passed");
process.exit(failures ? 1 : 0);
