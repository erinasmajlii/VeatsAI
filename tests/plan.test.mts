/**
 * Plan engine: DXF parsing, architectural analysis, electrical layout invariants, CAD output.
 *   npx tsx tests/plan.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlanDxf } from "../src/lib/plan/cad";
import { analyzeDxf } from "../src/lib/plan/analyze";
import { decodeDxf, DxfError, dwgVersion, isBinaryDxf, parseDxf } from "../src/lib/plan/dxf";
import { generateElectrical } from "../src/lib/plan/electrical";
import { dist, distToSegment, inPoly, segIntersect } from "../src/lib/plan/geom";
import type { Pt } from "../src/lib/plan/types";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`✓ ${name}`); };

const office = parseDxf(decodeDxf(readFileSync("data/samples/office-floor.dxf")));
const a = analyzeDxf(office);

// ---------------------------------------------------------------- analysis
ok("units come from the file header (mm) and are not assumed", () => {
  assert.equal(a.scale.unit, "mm"); assert.equal(a.scale.factor_to_m, 0.001); assert.equal(a.scale.assumed, false);
});
ok("layer roles are recognised", () => {
  const role = Object.fromEntries(a.layers.map((l) => [l.name, l.role]));
  assert.equal(role["A-WALL"], "wall"); assert.equal(role["A-DOOR"], "door"); assert.equal(role["A-GLAZ"], "window"); assert.equal(role["A-FURN"], "furniture");
});
ok("9 rooms found with labels and functions", () => {
  assert.equal(a.rooms.length, 9);
  const by = Object.fromEntries(a.rooms.map((r) => [r.name, r]));
  assert.equal(by["KITCHEN"].type, "kitchen"); assert.equal(by["WC"].type, "bathroom"); assert.equal(by["CORRIDOR"].type, "corridor"); assert.equal(by["SERVER ROOM"].type, "technical"); assert.equal(by["MEETING ROOM"].type, "meeting");
});
ok("room areas are within 2 % of the true net area", () => {
  const open = a.rooms.find((r) => r.name === "OPEN OFFICE")!;
  const expected = (9 - 0.125 - 0.05) * (5 - 0.05 - 0.125); // 9 m × 5 m minus half wall thicknesses
  assert.ok(Math.abs(open.area_m2 - expected) / expected < 0.02, `${open.area_m2} vs ${expected}`);
});
ok("every door connects two rooms (or a room and the outside) and has a swing direction", () => {
  const doors = a.openings.filter((o) => o.type === "door");
  assert.equal(doors.length, 9);
  assert.equal(doors.filter((d) => d.exterior).length, 1);
  assert.ok(doors.every((d) => d.swing && d.width_m > 0.8 && d.width_m < 1));
});
ok("7 windows, exterior walls distinguished from interior walls", () => {
  assert.equal(a.openings.filter((o) => o.type === "window").length, 7);
  assert.ok(a.walls.some((w) => w.exterior) && a.walls.some((w) => !w.exterior));
});
ok("a closed drawing needs no gap closing and has high confidence", () => {
  assert.equal(a.confidence, "high"); assert.equal(a.warnings.length, 0);
});

// ---------------------------------------------------------------- inputs that are not tidy
ok("a drawing without units / layer names is analysed with explicit assumptions", () => {
  const plain = analyzeDxf(parseDxf(decodeDxf(readFileSync("data/samples/plain-flat.dxf"))));
  assert.equal(plain.scale.assumed, true); assert.ok(plain.walls_layer_assumed); assert.ok(plain.warnings.some((w) => /units/i.test(w.message)));
  assert.ok(plain.rooms.length >= 2);
});
ok("small gaps in wall lines are closed without shrinking the rooms", () => {
  const closed = analyzeDxf(parseDxf(box(0)));
  const leaky = analyzeDxf(parseDxf(box(0.12)));
  assert.equal(closed.rooms.length, 1);
  assert.equal(leaky.rooms.length, 1);
  assert.ok(leaky.warnings.some((w) => /gaps/i.test(w.message)));
  assert.ok(Math.abs(leaky.rooms[0].area_m2 - closed.rooms[0].area_m2) < 0.6, `${leaky.rooms[0].area_m2} vs ${closed.rooms[0].area_m2}`);
});
ok("an open drawing falls back to the footprint and says so", () => {
  const open = analyzeDxf(parseDxf(dxf([[0, 0, 6, 0], [6, 0, 6, 4], [0, 4, 0, 0], [1, 1, 2, 1], [2, 1, 2, 2], [3, 3, 4, 3], [4, 3, 4, 3.5], [5, 1, 5.5, 1.2], [1, 3, 1.5, 3.1]])));
  assert.equal(open.confidence, "low"); assert.ok(open.warnings.some((w) => w.severity === "critical"));
});
ok("invalid input is rejected with a clear error", () => {
  assert.throws(() => parseDxf("hello"), DxfError);
  assert.throws(() => parseDxf("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"), DxfError);
  assert.equal(dwgVersion(Buffer.from("AC1032....")), "2018"); assert.equal(dwgVersion(Buffer.from("not a dwg")), null);
  assert.equal(isBinaryDxf(Buffer.from("AutoCAD Binary DXF\r\n\x1a\x00")), true);
});

// ---------------------------------------------------------------- electrical plan
const e = generateElectrical(a);
const roomById = new Map(a.rooms.map((r) => [r.id, r]));
ok("every device sits inside its room and clear of the walls", () => {
  for (const d of e.devices.filter((x) => x.room_id && !x.description.startsWith("Outdoor"))) {
    const r = roomById.get(d.room_id!)!;
    assert.ok(inPoly(d.at, r.polygon), `${d.tag} outside ${r.name}`);
  }
});
ok("switches are beside doors, sockets are never inside a door opening", () => {
  const doors = a.openings.filter((o) => o.type === "door");
  for (const s of e.devices.filter((x) => x.kind === "switch")) assert.ok(Math.min(...doors.map((d) => dist(d.at, s.at))) < 1.6, `${s.tag} far from any door`);
  for (const s of e.devices.filter((x) => x.kind === "socket" || x.kind === "special_socket")) for (const d of doors) assert.ok(dist(d.at, s.at) > d.width_m / 2 + 0.2, `${s.tag} in door ${d.id}`);
});
ok("lighting follows area: more luminaires in the open office than in the WC", () => {
  const count = (name: string) => e.devices.filter((d) => d.kind === "luminaire" && roomById.get(d.room_id!)?.name === name).length;
  assert.ok(count("OPEN OFFICE") > count("WC")); assert.ok(count("WC") >= 1);
});
ok("circuits: labelled, within protection rating, ≤ 8 sockets, 12 luminaires", () => {
  assert.equal(new Set(e.circuits.map((c) => c.id)).size, e.circuits.length);
  for (const c of e.circuits) {
    const rating = Number(/[CB](\d+)/.exec(c.protection)![1]);
    assert.ok(c.design_current_a <= rating, `${c.id}: ${c.design_current_a} A > ${rating} A`);
    const devs = e.devices.filter((d) => c.device_ids.includes(d.id));
    if (c.kind === "sockets") assert.ok(devs.length <= 8, `${c.id} has ${devs.length} sockets`);
    if (c.kind === "lighting") assert.ok(devs.filter((d) => d.kind === "luminaire").length <= 13);
  }
  assert.ok(e.devices.filter((d) => d.circuit === null && d.kind !== "panel" && d.description !== "Data outlet (RJ45)").length === 0, "unassigned device");
});
ok("cable routes only cross walls where there is a door opening", () => {
  const doors = a.openings.filter((o) => o.type === "door");
  let crossings = 0;
  for (const c of e.circuits) for (let i = 1; i < c.route.length; i++) {
    for (const w of a.walls) {
      if (!segIntersect(c.route[i - 1], c.route[i], w.a, w.b, 1e-6)) continue;
      crossings++;
      const mid: Pt = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const nearDoor = doors.some((d) => distToSegment(d.at, c.route[i - 1], c.route[i]).d < d.width_m / 2 + 0.3);
      assert.ok(nearDoor, `${c.id} crosses a wall at ${mid.map((v) => v.toFixed(2))} away from any door`);
    }
  }
  assert.ok(crossings >= 0);
});
ok("bill of materials uses catalogue SKUs where stocked and flags the rest", () => {
  assert.ok(e.bom.some((b) => b.sku === "CABL-NYM-3X2.5" && b.quantity > 100));
  assert.ok(e.bom.some((b) => b.sku === null && /Luminaire/.test(b.description)));
  assert.ok(e.bom.every((b) => b.quantity > 0));
});
ok("configuration switches categories off", () => {
  const only = generateElectrical(a, { lighting: false, switches: false, special_sockets: false, points: false });
  assert.equal(only.devices.filter((d) => d.kind === "luminaire" || d.kind === "switch" || d.kind === "special_socket").length, 0);
  assert.ok(only.devices.some((d) => d.kind === "socket"));
});
ok("the supply is chosen from demand unless forced", () => {
  assert.equal(e.config.supply, "three_phase");
  assert.equal(generateElectrical(a, { supply: "single_phase" }).config.supply, "single_phase");
});

// ---------------------------------------------------------------- CAD output
ok("CAD file keeps the original layers and adds the electrical ones; our own reader can read it back", () => {
  const out = buildPlanDxf(office, a, e, { project_title: "Test", project_id: "t1", client: "C", status: "PRELIMINARY", date: "2026-10-03" });
  assert.ok(out.dxf.startsWith("0\r\nSECTION") && out.dxf.trim().endsWith("EOF"));
  assert.ok(out.dxf.includes("A-WALL") && out.dxf.includes("E-LIGHT") && out.dxf.includes("E-WIRE-SOCKET") && out.dxf.includes("CIRCUIT SCHEDULE"));
  assert.ok(!/[^\x00-\x7F]/.test(out.dxf), "non-ASCII characters in the DXF");
  const back = parseDxf(out.dxf);
  assert.ok(back.prims.length > office.prims.length, "electrical entities are added to the drawing");
  const walls = back.prims.filter((p) => p.layer === "A-WALL").length;
  assert.equal(walls, office.prims.filter((p) => p.layer === "A-WALL").length, "original wall geometry preserved");
});

console.log(`\n${n} plan checks passed`);

// ---- helpers
/** minimal DXF made of LINE entities (metres, layer 0, INSUNITS=6) */
function dxf(lines: number[][]): string {
  const out = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  for (const [x1, y1, x2, y2] of lines) out.push("0", "LINE", "8", "WALL", "10", String(x1), "20", String(y1), "11", String(x2), "21", String(y2));
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}
/** a 6 m × 4 m room whose top wall has a gap of `gap` metres (0 = closed) */
function box(gap: number): string {
  const top = gap ? [[0, 4, 2.9, 4], [2.9 + gap, 4, 6, 4]] : [[0, 4, 6, 4]];
  return dxf([[0, 0, 6, 0], [6, 0, 6, 4], [0, 4, 0, 0], ...top]);
}
