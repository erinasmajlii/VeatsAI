@AGENTS.md

# VeatsAI — project instructions

AI-assisted engineering platform for electrical panel builders:
natural language → AI understanding → engineering → standards → BOM → inventory → cost → CAD → quote → engineer approval.
Hackathon MVP — keep the main demo flow working above everything else.

## Commands
- `npm run dev` — start the app (http://localhost:3000)
- `npm run build` — must pass before every merge
- `npm run lint` — must pass before every merge
- `BASE_URL=http://localhost:3000 npm run test:e2e` — end-to-end demo check (needs `npm run dev` running)

## Architecture (see README.md)
- `src/lib/ai` — LLM request understanding only (Gemini / Claude, Zod-validated) + rule-based fallback
- `src/lib/engineering` — deterministic calculations. **Never use the LLM for math.**
- `src/lib/standards` — standards + rule objects; every result references a rule id + standard
- `src/lib/bom`, `src/lib/inventory`, `src/lib/cost`, `src/lib/cad` — component selection, stock, cost, SVG/DXF
- `src/lib/projects/service.ts` — workflow orchestration, review actions, approval, quotes
- `src/lib/db` — Supabase repository or local JSON fallback (`.data/db.json`)
- `src/app` — pages + API routes; `src/components` — shared UI

## Rules
- Engineering safety language: use "AI-assisted", "standards-referenced", "preliminary", "requires engineer approval".
  Never "compliant", "certified", "guaranteed safe", "ready for installation". Never invent standard clauses or editions.
- Never hide uncertainty: missing data → warning or "Insufficient data", defaults → "Assumed value".
- API keys only in `.env.local` (git-ignored), read server-side. Never commit or print secrets.
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
