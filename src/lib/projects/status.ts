import type { ProjectStatus } from "../types";

/** Client-safe lifecycle helpers. Draft → In progress → Pending approval → Approved → Released. */

export const LIFECYCLE = ["DRAFT", "IN_PROGRESS", "ENGINEERING_REVIEW", "APPROVED", "RELEASED"] as const;
export type LifecycleStep = (typeof LIFECYCLE)[number];

/** Position of a status in the 5-step lifecycle (sub-states of "in progress" map to step 1). */
export function lifecycleIndex(s: ProjectStatus): number {
  switch (s) {
    case "DRAFT": return 0;
    case "IN_PROGRESS":
    case "MISSING_INFORMATION":
    case "AI_PROCESSING":
    case "NEEDS_CHANGES": return 1;
    case "ENGINEERING_REVIEW": return 2;
    case "APPROVED": return 3;
    case "RELEASED": return 4;
  }
}

/** Approved, or already released after approval. */
export const isApprovedStatus = (s: ProjectStatus) => s === "APPROVED" || s === "RELEASED";
