# VeatsAI

AI-assisted engineering platform for companies that design and build electrical systems.

**From natural language → engineering → standards → BOM → inventory → cost → CAD → quote → engineer approval.**

A client request such as *"Design a control panel for 3 motors rated at 15 kW each at 400V."* becomes a structured, traceable engineering project and a professional quote. The engineer stays the final authority.

> VeatsAI produces **AI-assisted, standards-referenced, preliminary** engineering. It does not certify compliance, guarantee safety, or produce designs that are ready to install without review. Every result requires engineer approval.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add AI_API_KEY and Supabase credentials
npm run dev                  # http://localhost:3000
```

With no environment variables set, the app still runs end to end:
- request understanding uses the **rule-based parser**, which is labelled in the UI
- data is stored in a **local JSON database** at `.data/db.json`, seeded automatically

### Demo

1. Open **New Project**, click **Use demo request**, then **Analyse Request**.
2. The AI analysis shows 3 × 15 kW motors at 400 V. The starting method is flagged as **missing** (required); cable length, environment and other fields are flagged as recommended.
3. Select **Direct-on-line (DOL)**. Optionally enter a cable length (e.g. 30 m) and an environment (e.g. Indoor, dusty). Click **Generate Engineering Design**.
4. Review the calculations (28.3 A per motor, 100 A main breaker, 6 mm² cable), the warnings, the BOM with inventory status, the cost, and the CAD single-line diagram (SVG preview + DXF download).
5. Edit as the engineer: change margin, quantities or PF/η; replace a component; add a note.
6. Acknowledge the critical warnings, then click **APPROVE PROJECT**.
7. Click **Generate Quote**. The quote page uses **Download PDF / Print** to save a PDF via the browser.

Automated check, against a running server:

```bash
npm run dev
BASE_URL=http://localhost:3000 npm run test:e2e
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | no | Google Gemini key, used server-side only. Takes priority when set. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash`. |
| `AI_API_KEY` | no | Claude API key, used server-side only (`ANTHROPIC_API_KEY` also works). `AI_MODEL` defaults to `claude-opus-5-5`. |
| `AI_PROVIDER` | no | `gemini` or `anthropic`, to force one when both keys are set. With no key, the rule-based parser is used. |
| `SUPABASE_URL` | no | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Server-side only. When both Supabase variables are set, Supabase replaces the local JSON database. |
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_EMAIL`, `DEFAULT_ENGINEER` | no | Text shown on quotes. |

`.env.local` is git-ignored. Never commit keys and never prefix secrets with `NEXT_PUBLIC_`.

## Supabase setup

1. Create a Supabase project. Copy the **Project URL** and the **service_role** key from Project Settings → API into `.env.local`.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor, or use `supabase db push`.
3. Run `supabase/seed.sql`. If you skip this, the app seeds `products`, `inventory` and `standards` automatically on first access. **Settings → Re-seed database** also re-seeds.

RLS is enabled on every table, with no anon policies. The app reads and writes only from server code, using the service-role key.

Tables: `users`, `standards`, `products`, `inventory`, `projects`, `project_components`, `engineering_calculations`, `quotes`, `project_reviews`.

## Architecture

All modules live in one Next.js app (App Router, TypeScript, Tailwind) and are separated by responsibility:

```
src/lib/
  ai/            Claude request understanding → JSON (Zod-validated, retry) + rule-based fallback
  engineering/   deterministic calculations (no LLM): current, protection, contactor, cable, voltage drop
  standards/     standards catalog + rule objects (id, standard, inputs, severity, implementation)
  bom/           component selection from catalog attributes + engineer overrides
  inventory/     seed catalog (client dataset + labelled demo items), stock status
  cost/          material + labor + engineering + margin
  cad/           CAD data contract → local SVG/DXF generator; AutoCAD/MCP adapter stub
  projects/      workflow orchestration, review actions, approval, quotes
  db/            Supabase repository, or local JSON fallback
src/app/api/     REST endpoints (see below)
src/app/         dashboard, projects, project workspace, quote, inventory, quotes, standards, settings
```

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/ai/analyze` | natural language → validated structured JSON |
| `POST /api/projects` | analyse the request and create a project |
| `POST /api/projects/:id/design` | supply missing info and run the full pipeline |
| `POST /api/projects/:id/review` | engineer actions: edit inputs/BOM/cost, acknowledge warnings, add notes, request changes |
| `POST /api/projects/:id/approve` | approve (blocked while critical warnings are unacknowledged) |
| `GET /api/projects/:id/dxf` | download the drawing as DXF |
| `POST /api/engineering/calculate` | stand-alone calculation from `{ inputs }` |
| `POST /api/engineering/bom` | calculation + BOM + inventory from `{ inputs }` |
| `GET /api/inventory` | products with stock status |
| `POST /api/cost/calculate` | cost preview with an alternative margin |
| `POST /api/cad/generate` | CAD contract + SVG + DXF |
| `POST /api/quotes/generate`, `GET /api/quotes` | quotes |
| `GET /api/standards`, `GET /api/status` | standards & rules, integration status |

### What is real and what is mock

- **Real:** structured AI extraction with Gemini or Claude (when a key is set); Zod validation with retry; deterministic engineering math; the standards rule engine and traceability; catalog-based component selection; inventory checks; the cost engine; SVG and DXF generation; the review/approval workflow; Supabase persistence; the printable quote.
- **Reference data / simplified:** cable ampacity and correction factors are indicative values; labor and engineering hours are estimates; the IP mapping is a configurable company rule.
- **Mock / not implemented:** the AutoCAD/MCP integration (stub adapter only), NEC rules (selectable as "coming soon" only), authentication, short-circuit and selectivity calculations, and IEC 61439 design verification.

### Product catalog

`data/products.client.json` is the company inventory dataset, used verbatim. `src/lib/inventory/catalog.ts` adds machine-readable attributes (rating, setting range, cross-section, IP) so the engine can match products. Items marked **Demo data** (pushbuttons, E-stop, pilot light, VFD) are dummy items for device types the dataset does not contain.

With this catalog, the demo design reports the overload relay as **Component unavailable**: the only relay in stock (LRD332) covers 17–25 A, and the motors draw 28.3 A. Adding a 23–32 A relay (e.g. LRD340) or a 25–32 A motor protection switch to the inventory resolves it.
