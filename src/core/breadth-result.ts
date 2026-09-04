import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  BreadthCandidate,
  BreadthLedgerCounts,
  BreadthLedgerEvidence,
  BreadthLedgerMode,
  BreadthLedgerTelemetry,
  BreadthResult,
  CompactedBreadthLedger,
} from "../types.js";
import { claudeSchemaJson } from "./paths.js";

export const MAX_BREADTH_LEDGER_CHARS = 24_000;
export const MAX_CLEAR_EXPLANATION_SAMPLES = 8;
export const MAX_COMPACT_CLEAR_ITEMS = 64;
export const MAX_COMPACT_CLEAR_REASON_CHARS = 400;

const ROOT_KEYS = new Set(["model", "candidates", "clear", "escalations", "coverage"]);
const COMPACT_ROOT_KEYS = new Set([
  "schemaVersion",
  "kind",
  "model",
  "candidates",
  "clearExamples",
  "clearCounts",
  "escalations",
  "coverage",
  "compaction",
]);
const CANDIDATE_KEYS = new Set([
  "id",
  "lane",
  "file",
  "line",
  "invariant",
  "counterexample",
  "evidenceNeeded",
]);
const COUNT_KEYS = new Set([
  "candidates",
  "clearExplanations",
  "clearGroups",
  "escalations",
  "coveredFiles",
  "unavailable",
]);

export function breadthSchemaName(
  mode: BreadthLedgerMode = "full",
): "breadth-result" | "breadth-result-compact" {
  return mode === "structural-compact" ? "breadth-result-compact" : "breadth-result";
}

export function breadthSchemaJson(mode: BreadthLedgerMode = "full"): string {
  return claudeSchemaJson(breadthSchemaName(mode));
}

export function parseBreadthLedgerTelemetry(
  value: unknown,
  source = "breadth ledger telemetry",
): BreadthLedgerTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "mode",
    "applied",
    "originalCounts",
    "transmittedCounts",
    "omittedCounts",
    "originalCharacters",
    "transmittedCharacters",
    "originalSha256",
  ]), source);
  if (!(root.mode === "full" ||
      root.mode === "structural-compact" ||
      root.mode === "adaptive-structural-compact")) {
    throw new Error(`${source}.mode is invalid`);
  }
  if (typeof root.applied !== "boolean") throw new Error(`${source}.applied must be boolean`);
  const originalCounts = parseCounts(root.originalCounts, `${source}.originalCounts`);
  const transmittedCounts = parseCounts(root.transmittedCounts, `${source}.transmittedCounts`);
  const omittedCounts = parseCounts(root.omittedCounts, `${source}.omittedCounts`);
  for (const key of Object.keys(originalCounts) as Array<keyof BreadthLedgerCounts>) {
    if (originalCounts[key] !== transmittedCounts[key] + omittedCounts[key]) {
      throw new Error(`${source} count ${key} does not reconcile`);
    }
    if (key !== "clearExplanations" && omittedCounts[key] !== 0) {
      throw new Error(`${source} cannot omit ${key}`);
    }
  }
  if (root.mode === "full") {
    if (root.applied || omittedCounts.clearExplanations !== 0) {
      throw new Error(`${source} full mode cannot apply compaction or omit clear explanations`);
    }
  } else if (root.applied !== (omittedCounts.clearExplanations > 0)) {
    throw new Error(`${source}.applied does not match omitted clear explanations`);
  }
  const originalCharacters = positiveInteger(root.originalCharacters, `${source}.originalCharacters`);
  const transmittedCharacters = positiveInteger(
    root.transmittedCharacters,
    `${source}.transmittedCharacters`,
  );
  if (transmittedCharacters > MAX_BREADTH_LEDGER_CHARS) {
    throw new Error(`${source}.transmittedCharacters exceeds the hard ledger limit`);
  }
  if (root.mode === "full" && originalCharacters !== transmittedCharacters) {
    throw new Error(`${source} full mode character counts must match`);
  }
  return {
    mode: root.mode,
    applied: root.applied,
    originalCounts,
    transmittedCounts,
    omittedCounts,
    originalCharacters,
    transmittedCharacters,
    originalSha256: hash(root.originalSha256, `${source}.originalSha256`),
  };
}

export function parseBreadthLedgerEvidence(
  value: unknown,
  source = "breadth ledger evidence",
): BreadthLedgerEvidence {
  const root = object(value, source);
  onlyKeys(root, new Set(["providerOutput", "transmittedLedger", "telemetry"]), source);
  const telemetry = parseBreadthLedgerTelemetry(root.telemetry, `${source}.telemetry`);
  const providerOutput = parseBreadthResult(
    root.providerOutput,
    `${source}.providerOutput`,
    telemetry.mode,
  );
  const expected = serializeBreadthLedger(providerOutput, telemetry.mode);
  const transmittedLedger = parseBreadthArtifactOutput(
    root.transmittedLedger,
    `${source}.transmittedLedger`,
  );
  if (!isDeepStrictEqual(transmittedLedger, expected.output)) {
    throw new Error(`${source}.transmittedLedger does not match provider output`);
  }
  if (!isDeepStrictEqual(telemetry, expected.telemetry)) {
    throw new Error(`${source}.telemetry does not match provider output`);
  }
  return { providerOutput, transmittedLedger, telemetry };
}

export function parseBreadthResult(
  value: unknown,
  source = "breadth output",
  mode: BreadthLedgerMode = "full",
): BreadthResult {
  const root = object(value, source);
  onlyKeys(root, ROOT_KEYS, source);
  const result = parseBreadthFields(root, source);
  if (mode === "structural-compact") {
    if (result.clear.length > MAX_COMPACT_CLEAR_ITEMS) {
      throw new Error(`${source}.clear must contain at most ${MAX_COMPACT_CLEAR_ITEMS} entries`);
    }
    result.clear.forEach((entry, index) => {
      if (entry.reason.length > MAX_COMPACT_CLEAR_REASON_CHARS) {
        throw new Error(
          `${source}.clear[${index}].reason must contain at most ${MAX_COMPACT_CLEAR_REASON_CHARS} characters`,
        );
      }
    });
  }
  return result;
}

export function parseCompactedBreadthLedger(
  value: unknown,
  source = "compacted breadth ledger",
): CompactedBreadthLedger {
  const root = object(value, source);
  onlyKeys(root, COMPACT_ROOT_KEYS, source);
  if (root.schemaVersion !== 1 || root.kind !== "structural-compact") {
    throw new Error(`${source} must identify structural-compact schema version 1`);
  }
  if (!Array.isArray(root.clearExamples)) throw new Error(`${source}.clearExamples must be an array`);
  if (!Array.isArray(root.clearCounts)) throw new Error(`${source}.clearCounts must be an array`);
  const base = parseBreadthFields({
    model: root.model,
    candidates: root.candidates,
    clear: root.clearExamples,
    escalations: root.escalations,
    coverage: root.coverage,
  }, source);
  const seenGroups = new Set<string>();
  const clearCounts = root.clearCounts.map((entry, index) => {
    const item = object(entry, `${source}.clearCounts[${index}]`);
    onlyKeys(item, new Set(["lane", "file", "count"]), `${source}.clearCounts[${index}]`);
    const summary = {
      lane: string(item.lane, `${source}.clearCounts[${index}].lane`, 120),
      file: safePath(item.file, `${source}.clearCounts[${index}].file`),
      count: positiveInteger(item.count, `${source}.clearCounts[${index}].count`),
    };
    const key = `${summary.file}\0${summary.lane}`;
    if (seenGroups.has(key)) throw new Error(`${source}.clearCounts contains a duplicate file/lane group`);
    seenGroups.add(key);
    return summary;
  });

  const compaction = object(root.compaction, `${source}.compaction`);
  onlyKeys(compaction, new Set([
    "applied",
    "originalCounts",
    "transmittedCounts",
    "omittedCounts",
    "originalCharacters",
    "transmittedCharacters",
    "originalSha256",
  ]), `${source}.compaction`);
  if (typeof compaction.applied !== "boolean") {
    throw new Error(`${source}.compaction.applied must be boolean`);
  }
  const originalCounts = parseCounts(compaction.originalCounts, `${source}.compaction.originalCounts`);
  const transmittedCounts = parseCounts(compaction.transmittedCounts, `${source}.compaction.transmittedCounts`);
  const omittedCounts = parseCounts(compaction.omittedCounts, `${source}.compaction.omittedCounts`);
  const originalCharacters = positiveInteger(
    compaction.originalCharacters,
    `${source}.compaction.originalCharacters`,
  );
  const transmittedCharacters = positiveInteger(
    compaction.transmittedCharacters,
    `${source}.compaction.transmittedCharacters`,
  );
  const originalSha256 = hash(compaction.originalSha256, `${source}.compaction.originalSha256`);

  const actualTransmitted: BreadthLedgerCounts = {
    candidates: base.candidates.length,
    clearExplanations: base.clear.length,
    clearGroups: clearCounts.length,
    escalations: base.escalations.length,
    coveredFiles: base.coverage.coveredFiles.length,
    unavailable: base.coverage.unavailable.length,
  };
  for (const key of Object.keys(actualTransmitted) as Array<keyof BreadthLedgerCounts>) {
    if (transmittedCounts[key] !== actualTransmitted[key]) {
      throw new Error(`${source}.compaction.transmittedCounts.${key} does not match the ledger`);
    }
    if (key !== "clearExplanations" && omittedCounts[key] !== 0) {
      throw new Error(`${source}.compaction cannot omit ${key}`);
    }
    if (originalCounts[key] !== transmittedCounts[key] + omittedCounts[key]) {
      throw new Error(`${source}.compaction count ${key} does not reconcile`);
    }
  }
  const summarizedClear = clearCounts.reduce((sum, entry) => sum + entry.count, 0);
  if (summarizedClear !== originalCounts.clearExplanations) {
    throw new Error(`${source}.clearCounts do not reconcile with original clear explanations`);
  }
  const sampledGroups = new Map<string, number>();
  for (const entry of base.clear) {
    const key = `${entry.file}\0${entry.lane}`;
    sampledGroups.set(key, (sampledGroups.get(key) ?? 0) + 1);
  }
  const declaredGroups = new Map(clearCounts.map((entry) => [
    `${entry.file}\0${entry.lane}`,
    entry.count,
  ]));
  for (const [key, count] of sampledGroups) {
    const declared = declaredGroups.get(key);
    if (declared === undefined || count > declared) {
      throw new Error(`${source}.clearExamples are not supported by clearCounts`);
    }
  }
  if (compaction.applied !== (omittedCounts.clearExplanations > 0)) {
    throw new Error(`${source}.compaction.applied does not match omitted clear explanations`);
  }
  if (transmittedCharacters > MAX_BREADTH_LEDGER_CHARS) {
    throw new Error(`${source}.compaction.transmittedCharacters exceeds the hard ledger limit`);
  }
  if (transmittedCharacters !== JSON.stringify(root).length) {
    throw new Error(`${source}.compaction.transmittedCharacters does not match serialized ledger length`);
  }

  return {
    schemaVersion: 1,
    kind: "structural-compact",
    model: base.model,
    candidates: base.candidates,
    clearExamples: base.clear,
    clearCounts,
    escalations: base.escalations,
    coverage: base.coverage,
    compaction: {
      applied: compaction.applied,
      originalCounts,
      transmittedCounts,
      omittedCounts,
      originalCharacters,
      transmittedCharacters,
      originalSha256,
    },
  };
}

export function serializeBreadthLedger(
  result: BreadthResult,
  mode: BreadthLedgerMode,
): {
  output: BreadthResult | CompactedBreadthLedger;
  text: string;
  telemetry: BreadthLedgerTelemetry;
} {
  const originalText = JSON.stringify(result);
  const clearCounts = summarizeClear(result.clear);
  const originalCounts = countsFor(result, clearCounts.length);
  if (mode === "full") {
    if (originalText.length > MAX_BREADTH_LEDGER_CHARS) {
      throw new Error(
        `breadth ledger exceeds ${MAX_BREADTH_LEDGER_CHARS} characters; refusing silent truncation`,
      );
    }
    const zeroOmitted = zeroCounts();
    return {
      output: result,
      text: originalText,
      telemetry: {
        mode,
        applied: false,
        originalCounts,
        transmittedCounts: { ...originalCounts },
        omittedCounts: zeroOmitted,
        originalCharacters: originalText.length,
        transmittedCharacters: originalText.length,
        originalSha256: createHash("sha256").update(originalText).digest("hex"),
      },
    };
  }

  if (mode === "adaptive-structural-compact" &&
      originalText.length <= MAX_BREADTH_LEDGER_CHARS) {
    let sampleCount = Math.min(MAX_CLEAR_EXPLANATION_SAMPLES, result.clear.length);
    while (sampleCount >= 0) {
      const output = buildCompactedLedger(
        result,
        result.clear.slice(0, sampleCount),
        clearCounts,
        originalCounts,
        originalText,
      );
      const text = JSON.stringify(output);
      if (text.length < originalText.length) {
        return { output, text, telemetry: { mode, ...output.compaction } };
      }
      sampleCount -= 1;
    }
    return {
      output: result,
      text: originalText,
      telemetry: {
        mode,
        applied: false,
        originalCounts,
        transmittedCounts: { ...originalCounts },
        omittedCounts: zeroCounts(),
        originalCharacters: originalText.length,
        transmittedCharacters: originalText.length,
        originalSha256: createHash("sha256").update(originalText).digest("hex"),
      },
    };
  }

  let sampleCount = Math.min(MAX_CLEAR_EXPLANATION_SAMPLES, result.clear.length);
  while (sampleCount >= 0) {
    const output = buildCompactedLedger(
      result,
      result.clear.slice(0, sampleCount),
      clearCounts,
      originalCounts,
      originalText,
    );
    const text = JSON.stringify(output);
    if (text.length <= MAX_BREADTH_LEDGER_CHARS) {
      return { output, text, telemetry: { mode, ...output.compaction } };
    }
    sampleCount -= 1;
  }
  throw new Error(
    `breadth ledger preserved high-value content exceeds ${MAX_BREADTH_LEDGER_CHARS} characters`,
  );
}

function countsFor(result: BreadthResult, clearGroups: number): BreadthLedgerCounts {
  return {
    candidates: result.candidates.length,
    clearExplanations: result.clear.length,
    clearGroups,
    escalations: result.escalations.length,
    coveredFiles: result.coverage.coveredFiles.length,
    unavailable: result.coverage.unavailable.length,
  };
}

function zeroCounts(): BreadthLedgerCounts {
  return {
    candidates: 0,
    clearExplanations: 0,
    clearGroups: 0,
    escalations: 0,
    coveredFiles: 0,
    unavailable: 0,
  };
}

export function parseBreadthArtifactOutput(
  value: unknown,
  source = "breadth artifact output",
): BreadthResult | CompactedBreadthLedger {
  const root = object(value, source);
  return root.kind === "structural-compact"
    ? parseCompactedBreadthLedger(root, source)
    : parseBreadthResult(root, source);
}

function buildCompactedLedger(
  result: BreadthResult,
  clearExamples: BreadthResult["clear"],
  clearCounts: CompactedBreadthLedger["clearCounts"],
  originalCounts: BreadthLedgerCounts,
  originalText: string,
): CompactedBreadthLedger {
  const transmittedCounts: BreadthLedgerCounts = {
    candidates: result.candidates.length,
    clearExplanations: clearExamples.length,
    clearGroups: clearCounts.length,
    escalations: result.escalations.length,
    coveredFiles: result.coverage.coveredFiles.length,
    unavailable: result.coverage.unavailable.length,
  };
  const omittedCounts: BreadthLedgerCounts = {
    candidates: 0,
    clearExplanations: result.clear.length - clearExamples.length,
    clearGroups: 0,
    escalations: 0,
    coveredFiles: 0,
    unavailable: 0,
  };
  const output: CompactedBreadthLedger = {
    schemaVersion: 1,
    kind: "structural-compact",
    model: result.model,
    candidates: result.candidates,
    clearExamples,
    clearCounts,
    escalations: result.escalations,
    coverage: result.coverage,
    compaction: {
      applied: omittedCounts.clearExplanations > 0,
      originalCounts,
      transmittedCounts,
      omittedCounts,
      originalCharacters: originalText.length,
      transmittedCharacters: 0,
      originalSha256: createHash("sha256").update(originalText).digest("hex"),
    },
  };
  for (;;) {
    const length = JSON.stringify(output).length;
    if (output.compaction.transmittedCharacters === length) return output;
    output.compaction.transmittedCharacters = length;
  }
}

function summarizeClear(clear: BreadthResult["clear"]): CompactedBreadthLedger["clearCounts"] {
  const groups = new Map<string, CompactedBreadthLedger["clearCounts"][number]>();
  for (const entry of clear) {
    const key = `${entry.file}\0${entry.lane}`;
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { lane: entry.lane, file: entry.file, count: 1 });
  }
  return [...groups.values()];
}

function parseBreadthFields(root: Record<string, unknown>, source: string): BreadthResult {
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
    clear: root.clear.map((entry, index) => parseClear(entry, `${source}.clear[${index}]`)),
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

function parseClear(value: unknown, source: string): BreadthResult["clear"][number] {
  const item = object(value, source);
  onlyKeys(item, new Set(["lane", "file", "reason"]), source);
  return {
    lane: string(item.lane, `${source}.lane`, 120),
    file: safePath(item.file, `${source}.file`),
    reason: string(item.reason, `${source}.reason`, 2000),
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

function parseCounts(value: unknown, source: string): BreadthLedgerCounts {
  const item = object(value, source);
  onlyKeys(item, COUNT_KEYS, source);
  return {
    candidates: nonNegativeInteger(item.candidates, `${source}.candidates`),
    clearExplanations: nonNegativeInteger(item.clearExplanations, `${source}.clearExplanations`),
    clearGroups: nonNegativeInteger(item.clearGroups, `${source}.clearGroups`),
    escalations: nonNegativeInteger(item.escalations, `${source}.escalations`),
    coveredFiles: nonNegativeInteger(item.coveredFiles, `${source}.coveredFiles`),
    unavailable: nonNegativeInteger(item.unavailable, `${source}.unavailable`),
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

function hash(value: unknown, source: string): string {
  const parsed = string(value, source, 64);
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${source} must be lowercase SHA-256 hex`);
  return parsed;
}

function positiveInteger(value: unknown, source: string): number {
  const parsed = nonNegativeInteger(value, source);
  if (parsed === 0) throw new Error(`${source} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${source} must be a non-negative safe integer`);
  }
  return value;
}
