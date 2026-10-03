@AGENTS.md

# VeatsAI — project instructions

Electrical engineering platform: plan upload → analysis → electrical plan → engineer review → approval → release (inventory), plus request → engineering → BOM → cost → CAD → quote.
Hackathon MVP — keep the main demo flow working above everything else.

## Commands
- `npm run dev` — start the app (http://localhost:3000)
- `npm run build` — must pass before every merge
- `npm run lint` — must pass before every merge
- `npm run test:unit`, and `npm run build && npm run test:e2e` (isolated production server + throw-away data; never run e2e against real data)

## Architecture (see README.md)
- `src/lib/ai` — LLM request understanding only (Groq / Gemini / Claude, Zod-validated) + rule-based fallback
- `src/lib/engineering` — deterministic calculations. **Never use the LLM for math.**
- `src/lib/standards` — standards + rule objects; every result references a rule id + standard
- `src/lib/bom`, `src/lib/inventory`, `src/lib/cost`, `src/lib/cad` — component selection, stock, cost, SVG/DXF
- `src/lib/projects/service.ts` — workflow orchestration, review actions, approval, quotes
- `src/lib/db` — Supabase repository or local JSON fallback (`.data/db.json`)
- `integrations/autocad-mcp` — Python MCP server → AutoCAD Electrical (COM). Start: `integrations/autocad-mcp/start.ps1`
- `src/lib/plan` — AutoCAD plan analysis, electrical layout, CAD writer; `src/lib/auth` — sessions; `src/proxy.ts` — route protection
- `src/app` — pages + API routes ((app) = signed-in pages); `src/components` — shared UI

## Rules
- Do not show AI branding in the UI ("powered by AI", robot icons, AI badges). Safety language: "standards-referenced", "preliminary", "requires engineer approval".
  Never "compliant", "certified", "guaranteed safe", "ready for installation". Never invent standard clauses or editions.
- Never hide uncertainty: missing data → warning or "Insufficient data", defaults → "Assumed value".
- API keys only in `.env.local` (git-ignored), read server-side. Never commit or print secrets.
- Approval/release must stay atomic (db/index.ts + supabase/migrations/0002). Only engineers approve/release (checked in the database).
- Do not modify `data/products.client.json` values — it is the company inventory dataset.

## Two-laptop workflow
Work is split so the two laptops rarely touch the same files:
- **Laptop A** → branch `feature/engine` → run `/laptop-a` (backend: `src/lib/**`, `src/app/api/**`, `supabase/**`)
- **Laptop B** → branch `feature/ui` → run `/laptop-b` (frontend: `src/app/**` pages, `src/components/**`, quote, CAD visuals)

Shared contract: `src/lib/types.ts`. Only add optional fields there; announce any other change to the other laptop first.

Sync cycle (about every 60 minutes, or after each finished task):
1. `git fetch origin && git merge origin/main` — resolve conflicts locally
2. `npm run lint && npm run build` (+ `npm run test:e2e` with the dev server running)
3. `git push` → open a PR into `main` (or fast merge: `git checkout main && git merge feature/... && git push`)
4. The other laptop pulls `main` into its branch on its next sync.
