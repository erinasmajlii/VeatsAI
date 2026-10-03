---
description: Laptop A — backend / engine work on branch feature/engine
---

You are working on **Laptop A** of the VeatsAI hackathon team. Read CLAUDE.md first (two-laptop workflow + rules).

## Setup (once)
1. `git fetch origin && git checkout feature/engine` (create it from `origin/main` if missing) and `git merge origin/main`.
2. `npm install`. Copy `.env.example` to `.env.local` if it does not exist and ask the user for keys. Never write keys anywhere else.
3. Start `npm run dev` and run `npm run test:e2e` (with BASE_URL) to confirm a green baseline.

## Your area (stay inside it)
`src/lib/**` (except UI-only helpers), `src/app/api/**`, `supabase/**`, `scripts/**`, `data/**` (new files only).
Do NOT edit pages in `src/app/**/page.tsx`, `src/app/projects/[id]/*.tsx` or `src/components/**` — that is Laptop B.
If you need a UI change, write it down in your final summary for Laptop B.

## Task list (in priority order — finish, test and merge one before starting the next)
1. **AI provider live**: once the user provides a working key, test `src/lib/ai/analyze.ts` with 5+ requests (English + Albanian,
   HP units, multiple motor groups, star-delta/VFD). Tighten the prompt/validation if extraction is wrong. If Gemini stays blocked,
   add a Groq provider (OpenAI-compatible JSON mode) behind the same `aiProvider()` switch.
2. **Protection coordination**: when the catalog has no breaker with `In ≤ Iz`, the BOM currently picks the 32 A MCB and raises a
   critical warning. Prefer increasing the cable size so `Ib ≤ In ≤ Iz` holds with the available breaker, and record the reason.
3. **Supabase**: with the user's Supabase project, run `supabase/migrations/0001_init.sql` + `supabase/seed.sql`, set env vars,
   and verify create → design → review → approve → quote persists (also rows in project_components / engineering_calculations).
4. **Engine unit tests**: add `scripts/engine-test.mjs` (or node:test) for `motorCurrent`, `nextStandardRating`, `selectCable`,
   voltage drop and the 3 × 15 kW demo (expected 28.3 A, 100 A main, 32 A branch, 6 mm²).
5. **Stock reservation on approval** (optional): on APPROVED, record reserved quantities (do not mutate the client dataset file).

## Done criteria for each task
`npm run lint && npm run build` pass, `npm run test:e2e` passes, then follow the sync cycle in CLAUDE.md
(merge origin/main → push → merge into main). Summarize what changed for the other laptop.
