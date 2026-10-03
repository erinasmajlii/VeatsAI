---
description: Laptop B — frontend / quote / CAD visuals on branch feature/ui
---

You are working on **Laptop B** of the VeatsAI hackathon team. Read CLAUDE.md first (two-laptop workflow + rules).

## Setup (once)
1. `git fetch origin && git checkout feature/ui` (create it from `origin/main` if missing) and `git merge origin/main`.
2. `npm install`. Copy `.env.example` to `.env.local` if it does not exist (keys are optional — the rule-based parser works without them).
3. Start `npm run dev` and run `npm run test:e2e` (with BASE_URL) to confirm a green baseline.

## Your area (stay inside it)
Pages and client components: `src/app/**/page.tsx`, `src/app/projects/**/*.tsx`, `src/app/*/` UI files, `src/components/**`,
`src/app/globals.css`, `src/lib/cad/**` (drawing/layout only), `README.md`.
Do NOT edit `src/lib/ai`, `src/lib/engineering`, `src/lib/standards`, `src/lib/bom`, `src/lib/cost`, `src/lib/db`, `src/lib/projects`
or `src/app/api/**` — that is Laptop A. If you need a backend change, write it down in your final summary for Laptop A.

## Task list (in priority order — finish, test and merge one before starting the next)
1. **Demo polish of the project workspace** (`src/app/projects/[id]/`): sticky section nav (AI · Engineering · Warnings · BOM ·
   Cost · CAD · Approval), clear loading states for "Generate Engineering Design", success toast after approve, and a visible
   "AI generated / Engineering calculation / Standards-based rule / Requires engineer review / Approved by engineer" legend.
2. **Quote PDF**: make the quote page print cleanly to A4 (page breaks, header/footer with quote number, no clipped tables).
   Optionally add a server-generated PDF download if it can be done quickly.
3. **CAD preview**: improve the single-line diagram in `src/lib/cad/index.ts` (layout only — keep the `CadContract` shape):
   cleaner symbols, device tags (Q1/K1/F1), rating labels that never overlap, and a simple control-circuit sheet if time allows.
4. **Mobile / small screens**: the sidebar is hidden below `md` — add a compact top nav so the demo works on a projector/laptop.
5. **Presentation**: add a short "How it works" panel on the dashboard and keep README demo steps accurate.

## Done criteria for each task
`npm run lint && npm run build` pass, `npm run test:e2e` passes, check the page visually, then follow the sync cycle in CLAUDE.md
(merge origin/main → push → merge into main). Summarize what changed for the other laptop.
