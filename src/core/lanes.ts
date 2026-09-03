import type { FindingCategory } from "../types.js";

export const CORE_LANE_IDS = [
  "authorization",
  "identifiers",
  "data-integrity",
  "persistence",
  "runtime-config",
  "contracts",
  "concurrency",
  "test-quality",
  "logic-correctness",
  "error-handling",
  "frontend-state",
  "boundaries-pagination",
] as const;

export type CoreLaneId = (typeof CORE_LANE_IDS)[number];
export type ManifestLaneId = CoreLaneId | (string & {});

export const CORE_LANE_CATEGORY: Readonly<Record<CoreLaneId, FindingCategory>> = {
  authorization: "authorization",
  identifiers: "identifiers",
  "data-integrity": "data-integrity",
  persistence: "persistence",
  "runtime-config": "runtime-config",
  contracts: "contracts",
  concurrency: "concurrency",
  "test-quality": "test-quality",
  "logic-correctness": "logic",
  "error-handling": "error-handling",
  "frontend-state": "frontend-state",
  "boundaries-pagination": "boundaries",
};

export function isCoreLaneId(value: unknown): value is CoreLaneId {
  return typeof value === "string" && (CORE_LANE_IDS as readonly string[]).includes(value);
}
