// Runs the end-to-end test against a PRODUCTION build on port 3100 with a throw-away data folder, so it can release
// projects and deduct inventory without touching your real data (.data) or your dev server.
//
//   npm run build && npm run test:e2e
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.E2E_PORT || "3100";
const DATA = join(process.cwd(), ".data-e2e");
if (!existsSync(join(".next", "BUILD_ID"))) {
  console.log("No production build found — running `npm run build` first…");
  const b = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
rmSync(DATA, { recursive: true, force: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  VEATS_DATA_DIR: DATA,
  VEATS_CAD_OUTPUT: join(DATA, "cad"),
  AUTH_SECRET: randomBytes(24).toString("hex"),
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  AUTOCAD_MCP_URL: "http://127.0.0.1:1/mcp", // never talk to a real AutoCAD from the test run
  BASE_URL: `http://localhost:${PORT}`,
};
const server = spawn(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "start", "-p", PORT], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
};
process.on("exit", stop);

let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { up = (await fetch(`${env.BASE_URL}/login`)).ok; } catch { /* not yet */ }
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error("Server did not start:\n" + log); stop(); process.exit(1); }

const t = spawnSync(process.execPath, ["scripts/e2e-demo.mjs"], { env, stdio: "inherit" });
stop();
rmSync(DATA, { recursive: true, force: true });
process.exit(t.status ?? 1);
