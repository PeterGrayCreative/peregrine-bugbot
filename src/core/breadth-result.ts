import type { BreadthCandidate, BreadthResult } from "../types.js";
import { claudeSchemaJson } from "./paths.js";

const ROOT_KEYS = new Set(["model", "candidates", "clear", "escalations", "coverage"]);
const CANDIDATE_KEYS = new Set([
  "id",
  "lane",
  "file",
  "line",
  "invariant",
  "counterexample",
  "evidenceNeeded",
]);

export function breadthSchemaJson(): string {
  return claudeSchemaJson("breadth-result");
}

export function parseBreadthResult(value: unknown, source = "breadth output"): BreadthResult {
  const root = object(value, source);
  onlyKeys(root, ROOT_KEYS, source);
  if (!Array.isArray(root.candidates)) throw new Error(`${source}.candidates must be an array`);
  if (!Array.isArray(root.clear)) throw new Error(`${source}.clear must be an array`);
  if (!Array.isArray(root.escalations)) throw new Error(`${source}.escalations must be an array`);
  const coverage = object(root.coverage, `${source}.coverage`);
  onlyKeys(coverage, new Set(["coveredFiles", "unavailable"]), `${source}.coverage`);

  return {
    model: string(root.model, `${source}.model`, 200),
    candidates: root.candidates.map((candidate, index) =>
      parseCandidate(candidate, `${source}.candidates[${index}]`),
    ),
    clear: root.clear.map((entry, index) => {
      const item = object(entry, `${source}.clear[${index}]`);
      onlyKeys(item, new Set(["lane", "file", "reason"]), `${source}.clear[${index}]`);
      return {
        lane: string(item.lane, `${source}.clear[${index}].lane`, 120),
        file: safePath(item.file, `${source}.clear[${index}].file`),
        reason: string(item.reason, `${source}.clear[${index}].reason`, 2000),
      };
    }),
    escalations: root.escalations.map((entry, index) => {
      const item = object(entry, `${source}.escalations[${index}]`);
      onlyKeys(item, new Set(["target", "reason"]), `${source}.escalations[${index}]`);
      return {
        target: string(item.target, `${source}.escalations[${index}].target`, 200),
        reason: string(item.reason, `${source}.escalations[${index}].reason`, 2000),
      };
    }),
    coverage: {
      coveredFiles: stringArray(coverage.coveredFiles, `${source}.coverage.coveredFiles`, true),
      unavailable: stringArray(coverage.unavailable, `${source}.coverage.unavailable`, false),
    },
  };
}

function parseCandidate(value: unknown, source: string): BreadthCandidate {
  const item = object(value, source);
  onlyKeys(item, CANDIDATE_KEYS, source);
  if (typeof item.line !== "number" || !Number.isInteger(item.line) || item.line < 1) {
    throw new Error(`${source}.line must be a positive integer`);
  }
  return {
    id: string(item.id, `${source}.id`, 120),
    lane: string(item.lane, `${source}.lane`, 120),
    file: safePath(item.file, `${source}.file`),
    line: item.line,
    invariant: string(item.invariant, `${source}.invariant`, 2000),
    counterexample: string(item.counterexample, `${source}.counterexample`, 2000),
    evidenceNeeded: string(item.evidenceNeeded, `${source}.evidenceNeeded`, 2000),
  };
}

function stringArray(value: unknown, source: string, paths: boolean): string[] {
  if (!Array.isArray(value)) throw new Error(`${source} must be an array`);
  return value.map((item, index) =>
    paths ? safePath(item, `${source}[${index}]`) : string(item, `${source}[${index}]`, 2000),
  );
}

function safePath(value: unknown, source: string): string {
  const path = string(value, source, 1024);
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === ".." || part === "." || part.length === 0)
  ) {
    throw new Error(`${source} must be a safe repository-relative Git path`);
  }
  return path;
}

function object(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, source: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);
}

function string(value: unknown, source: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source} must be a non-empty string`);
  }
  if (value.length > max) throw new Error(`${source} exceeds ${max} characters`);
  return value;
}
