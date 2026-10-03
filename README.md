# VEATSAI

Electrical engineering platform: **architectural plan → analysis → electrical plan → engineer review → approval → release (inventory)**, plus the original request-to-quote flow for motor control panels.

> Output is **preliminary and standards-referenced**. It does not certify compliance or safety; every result requires engineer approval.

## Quick start

```bash
npm install
cp .env.example .env.local   # set ENGINEER_SEED_EMAIL / ENGINEER_SEED_PASSWORD (and optional keys)
npm run dev                  # http://localhost:3000
```

With no other variables the app runs end to end on a **local JSON database** (`.data/db.json`). The first visit shows the intro animation, then **Continue to Login**. Sign in with the engineer defined by `ENGINEER_SEED_*` (created on first sign-in). More accounts:

```bash
node scripts/create-user.mjs --email you@company.com --name "Your Name" --role engineer   # engineer | sales | admin
```

### Demo: plan → electrical plan → CAD → approve → release
1. **Requests** → upload `data/samples/office-floor.dxf` (or your own `.dxf` / `.dwg`).
2. **Plan** tab: review the detected rooms, doors, windows and scale, then **Generate electrical plan**.
3. Review the plan on the drawing and the circuit schedule, then **Confirm review** (engineers).
4. **Generate CAD file** → **Download DXF** or **Open in AutoCAD**.
5. **Approve project** (engineer) — stores the engineer, project and time. Then **Release project**: the plan's stocked materials are deducted from inventory, once.

The request flow still works: write a request in the **Assistant** (right panel) or in **Requests**, complete the data, generate the design, review, approve, quote.

## Roles and approval
- Pages and APIs need a signed-in user (signed `httpOnly` cookie; `proxy.ts` is the first gate, route handlers re-check the user **and role in the database**).
- Only an **engineer** can approve, release or confirm a plan review. Sales/admin accounts can sign in and prepare work.
- `POST /api/projects/:id/approve` → rows in `project_approvals` (engineer id + name, project, timestamp, status) and on the project. A second approval is rejected (unique index + status check). Editing an approved project revokes the approval (kept in the history).
- `POST /api/projects/:id/release` (approved projects only) deducts the exact materials from inventory **atomically** and records every change in `inventory_movements`. A repeated release is rejected and never deducts again; insufficient stock fails the whole release with nothing deducted. Items without a catalogue SKU (e.g. luminaires) are listed as "to purchase" and not deducted.
- Lifecycle: Draft → In progress → Pending approval → Approved → Released (`MISSING_INFORMATION`, `AI_PROCESSING` and `NEEDS_CHANGES` are "In progress" sub-states). Released projects are locked.

## AutoCAD plans
- Upload `.dxf` (ASCII) or `.dwg`. DWG and binary DXF are converted through AutoCAD by the AutoCAD service (below); without it, upload an ASCII DXF.
- Analysis (`src/lib/plan`): units (header or inferred, always flagged when assumed), layer roles, walls (exterior/interior, thickness), doors with swing direction, windows, stairs, rooms (raster flood-fill, robust to double-line walls and small gaps) with areas, names and functions, dimension cross-check. Every assumption is shown as a warning.
- Electrical plan: luminaires, switches at door latch sides, sockets spread along walls, appliance points, data/outdoor points, circuits with labels/protection/cable, distribution board, cable routes that run inside rooms and through door openings, legend, technical data, assumptions, and a bill of materials mapped to the catalogue.
- CAD file: original drawing layers + `E-*` layers, circuit schedule, legend, title block (ASCII DXF).
- **Open in AutoCAD**: the server opens the DXF (and keeps a DWG copy) through the AutoCAD service; fallback is the OS default application for `.dxf`. Start the service on the AutoCAD machine:

```powershell
powershell -ExecutionPolicy Bypass -File integrations/autocad-mcp/start.ps1   # 127.0.0.1:8765 — restart it after updating
```

Sample plans: `data/samples/*.dxf` (regenerate with `npm run sample-plans`, needs `pip install ezdxf`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | production | Signs session cookies (≥ 16 chars). In development a random one is kept in `.data/auth-secret`. |
| `ENGINEER_SEED_EMAIL`, `ENGINEER_SEED_NAME`, `ENGINEER_SEED_PASSWORD` | first run | Engineer account created on first sign-in. |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `AI_API_KEY` (+ `*_MODEL`, `AI_PROVIDER`) | no | Request understanding for the written-request flow. Without a key a rule-based parser is used. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | no | Use Supabase instead of the local JSON database (server-side only). |
| `AUTOCAD_MCP_URL`, `VEATS_CAD_OUTPUT`, `VEATS_UPLOAD_DIR` | no | AutoCAD service URL; CAD output folder (default `Documents\VeatsAI\drawings`); upload folder (default `.data/uploads`). |
| `VEATS_DATA_DIR` | no | Folder for local state (default `.data`). Tests use a throw-away folder. |
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_EMAIL` | no | Text shown on quotes and About. |

`.env.local` is git-ignored. Never commit keys and never prefix secrets with `NEXT_PUBLIC_`.

## Supabase setup
1. Create a project; put the URL and **service_role** key in `.env.local`.
2. Run `supabase/migrations/0001_init.sql`, then `0002_auth_approval_release.sql` (engineer accounts, `project_approvals`, `inventory_movements`, and the transactional `approve_project` / `release_project` functions), then `supabase/seed.sql`.
3. `node scripts/create-user.mjs …` creates engineers in Supabase when the variables are set.

RLS is enabled on every table with no anon policies; the app only accesses data from server code.

## Architecture

```
src/lib/
  plan/          DXF parser, plan analysis, electrical layout, CAD (DXF) writer
  auth/          scrypt passwords, signed session tokens, sign-in
  db/            Supabase repository or local JSON; atomic approve/release
  projects/      workflow (service.ts), plan workflow (plan-service.ts), materials, lifecycle
  ai/, engineering/, standards/, bom/, inventory/, cost/, cad/   request → design → BOM → cost → CAD
src/app/(app)/   signed-in pages: dashboard, projects, requests, inventory, quotes, standards, about
src/app/         landing + intro, login, API routes
src/proxy.ts     route protection + same-origin check
integrations/autocad-mcp/   Python service driving AutoCAD over COM (open / convert / draw)
```

## Tests

```bash
npm run test:unit      # plan engine, auth + local DB atomicity, SQL migrations/functions (PGlite)
npm run build && npm run test:e2e   # production build on :3100 with a throw-away data folder
```
`scripts/e2e-demo.mjs` refuses to run unless `VEATS_DATA_DIR` points at a throw-away folder, because it releases projects and deducts inventory.

## Not implemented / limits
NEC rules, short-circuit and selectivity calculations, IEC 61439 design verification, multi-storey plans (one plan per project), DWG conversion without AutoCAD. Plan analysis is geometric: unusual drawing conventions can need layer/units review (warnings say what was assumed).
