import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { GroundTruth } from "../src/types.js";
import { isCoreLaneId } from "../src/core/review-lanes.js";

export function readCaseGroundTruth(casesDir: string, caseName: string): GroundTruth {
  const root = realpathSync(resolve(casesDir));
  const direct = resolve(root, caseName, "ground_truth.json");
  const selected = existsSync(direct) ? direct : aliasedTruthPath(root, caseName);
  const resolved = realpathSync(selected);
  if (!resolved.startsWith(`${root}${sep}`)) throw new Error("ground-truth path escapes the case corpus");
  return parseGroundTruth(JSON.parse(readFileSync(resolved, "utf8")), `ground truth for ${caseName}`);
}

export function parseGroundTruth(value: unknown, label = "ground truth"): GroundTruth {
  if (!value || typeof value !== "object" || !Array.isArray((value as { bugs?: unknown }).bugs)) {
    throw new Error(`${label} must contain a bugs array`);
  }
  const bugs = (value as { bugs: unknown[] }).bugs.map((bug) =>
    bug && typeof bug === "object" && !Array.isArray(bug) ? { ...(bug as Record<string, unknown>) } : bug);
  const ids = new Set<string>();
  for (const [index, rawBug] of bugs.entries()) {
    if (!rawBug || typeof rawBug !== "object" || Array.isArray(rawBug)) {
      throw new Error(`${label} bug ${index} must be an object`);
    }
    const bug = rawBug as Record<string, unknown>;
    if (typeof bug.id !== "string" || !bug.id) {
      throw new Error(`${label} bug ${index} needs a non-empty string id`);
    }
    if (ids.has(bug.id)) throw new Error(`${label} bug ${index} has a duplicate id`);
    ids.add(bug.id);
    if (typeof bug.file !== "string" || !bug.file) {
      throw new Error(`${label} bug ${index} needs a non-empty string file`);
    }
    if (
      !Number.isInteger(bug.startLine) ||
      !Number.isInteger(bug.endLine) ||
      (bug.startLine as number) < 1 ||
      (bug.endLine as number) < (bug.startLine as number)
    ) {
      throw new Error(`${label} bug ${index} needs a valid positive line range`);
    }
    if (typeof bug.description !== "string" || !bug.description.trim()) {
      throw new Error(`${label} bug ${index} needs a non-empty string description`);
    }
    bug.lane ??= "logic-correctness";
    bug.expectedDisposition ??= "fix-in-pr";
    bug.expectedSeverity ??= bug.severity ?? "medium";
    bug.reachablePreconditions ??= "Legacy benchmark artifact; preconditions were not recorded.";
    bug.observableImpact ??= bug.description;
    bug.provenance ??= "Legacy pre-root-cause grading artifact.";
    if (!isCoreLaneId(bug.lane)) throw new Error(`${label} bug ${index} has an invalid core lane`);
    if (bug.expectedDisposition !== "fix-in-pr" && bug.expectedDisposition !== "follow-up") {
      throw new Error(`${label} bug ${index} has an invalid expected disposition`);
    }
    if (bug.expectedSeverity !== "high" && bug.expectedSeverity !== "medium" && bug.expectedSeverity !== "low") {
      throw new Error(`${label} bug ${index} has an invalid expected severity`);
    }
    for (const field of ["reachablePreconditions", "observableImpact", "provenance"] as const) {
      if (typeof bug[field] !== "string" || !(bug[field] as string).trim()) {
        throw new Error(`${label} bug ${index} needs a non-empty ${field}`);
      }
    }
    if (bug.rootCauseGroup !== undefined && (typeof bug.rootCauseGroup !== "string" || !bug.rootCauseGroup.trim())) {
      throw new Error(`${label} bug ${index} rootCauseGroup must be a non-empty string when present`);
    }
  }
  return { bugs: bugs as GroundTruth["bugs"] };
}

function aliasedTruthPath(root: string, caseName: string): string {
  const aliasesPath = join(root, "case-aliases.json");
  if (!existsSync(aliasesPath)) throw new Error(`ground truth is unavailable for ${caseName}`);
  const aliases = JSON.parse(readFileSync(aliasesPath, "utf8")) as unknown;
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    throw new Error("case-aliases.json must contain an object");
  }
  const target = (aliases as Record<string, unknown>)[caseName];
  if (typeof target !== "string" || !target) {
    throw new Error(`ground truth is unavailable for ${caseName}`);
  }
  return resolve(root, target, "ground_truth.json");
}
