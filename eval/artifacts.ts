import { isDeepStrictEqual } from "node:util";
import { parseEngineResult } from "../src/core/review-result.js";
import { RUN_FAILURE_KINDS } from "../src/core/run-failure.js";
import { parseUsage } from "../src/core/telemetry.js";
import {
  CASE_CORPORA,
  type CaseCorpus,
  type GradedRun,
  type MatrixRunManifest,
  type NetworkIsolationCapability,
  type RunAttempt,
  type RunFailureTelemetry,
  type RunRecord,
  type StageTelemetry,
} from "../src/types.js";

const RECORD_KEYS = new Set([
  "schemaVersion", "attemptId", "caseName", "caseKind", "configName", "repeat",
  "caseCorpus", "startedAt", "finishedAt", "outcome",
  "runner",
]);
const GRADED_KEYS = new Set([...RECORD_KEYS, "matches", "falsePositiveIndexes"]);

export function parseMatrixRunManifest(value: unknown, source = "matrix manifest"): MatrixRunManifest {
  const root = object(value, source);
  onlyKeys(root, new Set(["schemaVersion", "createdAt", "expectedAttempts", "providerNetworkIsolation"]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const createdAt = isoDate(root.createdAt, `${source}.createdAt`);
  if (!Array.isArray(root.expectedAttempts)) throw new Error(`${source}.expectedAttempts must be an array`);
  const expectedAttempts = root.expectedAttempts.map((attempt, index) =>
    parseAttempt(attempt, `${source}.expectedAttempts[${index}]`));
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const attempt of expectedAttempts) {
    if (ids.has(attempt.id)) throw new Error(`${source}: duplicate attempt id ${attempt.id}`);
    if (files.has(attempt.file)) throw new Error(`${source}: duplicate attempt file ${attempt.file}`);
    ids.add(attempt.id);
    files.add(attempt.file);
  }
  const providerNetworkIsolation = parseNetworkIsolation(
    root.providerNetworkIsolation,
    `${source}.providerNetworkIsolation`,
  );
  return { schemaVersion: 1, createdAt, expectedAttempts, providerNetworkIsolation };
}

export function parseRunRecord(value: unknown, source: string, expected?: RunAttempt): RunRecord {
  const root = object(value, source);
  onlyKeys(root, RECORD_KEYS, source);
  const record = parseRecordFields(root, source);
  if (expected) assertAttemptIdentity(record, expected, source);
  return record;
}

export function parseGradedRun(value: unknown, source: string, expected?: RunAttempt): GradedRun {
  const root = object(value, source);
  onlyKeys(root, GRADED_KEYS, source);
  const record = parseRecordFields(root, source);
  if (record.outcome.status !== "completed") throw new Error(`${source}.outcome must be completed`);
  const completed = record.outcome;
  if (expected) assertAttemptIdentity(record, expected, source);
  const matchesRaw = object(root.matches, `${source}.matches`);
  const matches: Record<string, number | null> = {};
  for (const [bugId, findingIndex] of Object.entries(matchesRaw)) {
    strictString(bugId, `${source}.matches key`, 500);
    if (findingIndex !== null && !safeInteger(findingIndex, 0)) {
      throw new Error(`${source}.matches.${bugId} must be null or a non-negative safe integer`);
    }
    if (typeof findingIndex === "number" && findingIndex >= completed.result.findings.length) {
      throw new Error(`${source}.matches.${bugId} references a missing finding`);
    }
    matches[bugId] = findingIndex as number | null;
  }
  if (!Array.isArray(root.falsePositiveIndexes)) {
    throw new Error(`${source}.falsePositiveIndexes must be an array`);
  }
  const falsePositiveIndexes = root.falsePositiveIndexes.map((index, position) => {
    if (!safeInteger(index, 0) || index >= completed.result.findings.length) {
      throw new Error(`${source}.falsePositiveIndexes[${position}] must reference an existing finding`);
    }
    return index;
  });
  if (new Set(falsePositiveIndexes).size !== falsePositiveIndexes.length) {
    throw new Error(`${source}.falsePositiveIndexes must not contain duplicates`);
  }
  return { ...record, outcome: record.outcome, matches, falsePositiveIndexes };
}

export function assertGradedMatchesRun(graded: GradedRun, run: RunRecord, source: string): void {
  if (run.outcome.status !== "completed") throw new Error(`${source}: graded artifact cannot match a failed run`);
  for (const [field, actual, expected] of [
    ["caseKind", graded.caseKind, run.caseKind],
    ["startedAt", graded.startedAt, run.startedAt],
    ["finishedAt", graded.finishedAt, run.finishedAt],
  ] as const) {
    if (actual !== expected) throw new Error(`${source}.${field} does not match the run artifact`);
  }
  if (!isDeepStrictEqual(graded.outcome.result, run.outcome.result)) {
    throw new Error(`${source}.outcome.result does not match the run artifact`);
  }
  const matchedFindingIndexes = new Set(Object.values(graded.matches).filter((index): index is number => index !== null));
  const expectedFalsePositives = graded.outcome.result.findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding, index }) => finding.disposition === "fix-in-pr" && !matchedFindingIndexes.has(index))
    .map(({ index }) => index);
  if (!isDeepStrictEqual([...graded.falsePositiveIndexes].sort((a, b) => a - b), expectedFalsePositives)) {
    throw new Error(`${source}.falsePositiveIndexes does not match the graded findings`);
  }
}

export function parseLegacyCompletedRun(value: unknown, source: string): {
  caseName: string;
  caseKind: RunRecord["caseKind"];
  configName: string;
  repeat: number;
  startedAt: string;
  result: ReturnType<typeof parseEngineResult>;
  matches?: Record<string, number | null>;
  falsePositiveIndexes?: number[];
} {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "caseName", "caseKind", "configName", "repeat", "startedAt", "result",
    "matches", "falsePositiveIndexes",
  ]), source);
  const result = parseEngineResult(root.result, `${source}.result`);
  const base = {
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
    caseKind: caseKind(root.caseKind, `${source}.caseKind`),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    startedAt: isoDate(root.startedAt, `${source}.startedAt`),
    result,
  };
  if (root.matches === undefined && root.falsePositiveIndexes === undefined) return base;
  if (root.matches === undefined || root.falsePositiveIndexes === undefined) {
    throw new Error(`${source}: legacy graded fields must appear together`);
  }
  const synthetic = {
    schemaVersion: 1,
    attemptId: `legacy--${base.configName}--${base.caseName}--${base.repeat}`,
    caseName: base.caseName,
    caseKind: base.caseKind,
    configName: base.configName,
    repeat: base.repeat,
    caseCorpus: "unknown" as const,
    runner: result.engine,
    startedAt: base.startedAt,
    finishedAt: base.startedAt,
    outcome: { status: "completed" as const, result },
    matches: root.matches,
    falsePositiveIndexes: root.falsePositiveIndexes,
  };
  const parsed = parseGradedRun(synthetic, source);
  return { ...base, matches: parsed.matches, falsePositiveIndexes: parsed.falsePositiveIndexes };
}

function parseAttempt(value: unknown, source: string): RunAttempt {
  const root = object(value, source);
  onlyKeys(root, new Set(["id", "caseName", "configName", "repeat", "file", "corpus", "expectedBugCount", "runner"]), source);
  const id = strictString(root.id, `${source}.id`, 200);
  if (!/^attempt-[a-z0-9-]+$/i.test(id)) throw new Error(`${source}.id is not a safe attempt id`);
  const file = strictString(root.file, `${source}.file`, 240);
  if (file !== `${id}.json`) throw new Error(`${source}.file must equal ${id}.json`);
  return {
    id,
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    file,
    corpus: corpus(root.corpus, `${source}.corpus`),
    expectedBugCount: root.expectedBugCount === null
      ? null
      : nonNegativeSafeInteger(root.expectedBugCount, `${source}.expectedBugCount`),
    runner: runner(root.runner, `${source}.runner`),
  };
}

function parseRecordFields(root: Record<string, unknown>, source: string): RunRecord {
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const outcome = parseOutcome(root.outcome, `${source}.outcome`);
  if (outcome.status === "completed") {
    validateUsageProvider(outcome.result.engine, outcome.result.usage, `${source}.outcome.result.usage`);
    validateEngineStageTelemetry(outcome.result.raw, `${source}.outcome.result.raw`, outcome.result.engine);
  }
  const parsedRunner = runner(root.runner, `${source}.runner`);
  if (outcome.status === "completed" && outcome.result.engine !== parsedRunner) {
    throw new Error(`${source}.outcome.result.engine does not match runner`);
  }
  if (outcome.status === "failed" && outcome.telemetry && outcome.telemetry.engine !== parsedRunner) {
    throw new Error(`${source}.outcome.telemetry.engine does not match runner`);
  }
  const startedAt = isoDate(root.startedAt, `${source}.startedAt`);
  const finishedAt = isoDate(root.finishedAt, `${source}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error(`${source}.finishedAt must not precede startedAt`);
  }
  return {
    schemaVersion: 1,
    attemptId: strictString(root.attemptId, `${source}.attemptId`, 200),
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
    caseKind: caseKind(root.caseKind, `${source}.caseKind`),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    caseCorpus: corpus(root.caseCorpus, `${source}.caseCorpus`),
    runner: parsedRunner,
    startedAt,
    finishedAt,
    outcome,
  };
}

function validateEngineStageTelemetry(value: unknown, source: string, engine: RunRecord["runner"]): void {
  if (value === undefined) return;
  const raw = object(value, source);
  for (const stageName of ["breadth", "investigation"] as const) {
    if (raw[stageName] === undefined) continue;
    const stage = object(raw[stageName], `${source}.${stageName}`);
    if (stage.durationMs === undefined || stage.usage === undefined ||
      stage.model === undefined || stage.promptSha256 === undefined) {
      throw new Error(`${source}.${stageName} must include model, promptSha256, durationMs, and usage`);
    }
    nonNegativeSafeInteger(stage.durationMs, `${source}.${stageName}.durationMs`);
    const usage = parseUsage(stage.usage, `${source}.${stageName}.usage`);
    validateUsageProvider(engine, usage, `${source}.${stageName}.usage`);
    strictString(stage.model, `${source}.${stageName}.model`, 500);
    const promptSha256 = strictString(stage.promptSha256, `${source}.${stageName}.promptSha256`, 64);
    if (!/^[a-f0-9]{64}$/.test(promptSha256)) {
      throw new Error(`${source}.${stageName}.promptSha256 must be lowercase SHA-256 hex`);
    }
  }
}

function parseOutcome(value: unknown, source: string): RunRecord["outcome"] {
  const root = object(value, source);
  if (root.status === "completed") {
    onlyKeys(root, new Set(["status", "result"]), source);
    return { status: "completed", result: parseEngineResult(root.result, `${source}.result`) };
  }
  if (root.status !== "failed") throw new Error(`${source}.status must be completed or failed`);
  onlyKeys(root, new Set(["status", "failureKind", "message", "durationMs", "telemetry"]), source);
  if (!RUN_FAILURE_KINDS.includes(root.failureKind as (typeof RUN_FAILURE_KINDS)[number])) {
    throw new Error(`${source}.failureKind is invalid`);
  }
  return {
    status: "failed",
    failureKind: root.failureKind as (typeof RUN_FAILURE_KINDS)[number],
    message: strictString(root.message, `${source}.message`, 4000),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    telemetry: root.telemetry === undefined ? undefined : parseFailureTelemetry(root.telemetry, `${source}.telemetry`),
  };
}

function parseFailureTelemetry(value: unknown, source: string): RunFailureTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set(["engine", "modelConfig", "usage", "durationMs", "stages"]), source);
  if (!(root.engine === "claude" || root.engine === "codex" || root.engine === "mock")) {
    throw new Error(`${source}.engine is invalid`);
  }
  if (!Array.isArray(root.stages) || root.stages.length === 0 || root.stages.length > 2) {
    throw new Error(`${source}.stages must contain one or two stages`);
  }
  const stages = root.stages.map((stage, index) => parseStage(stage, `${source}.stages[${index}]`));
  if (new Set(stages.map((stage) => stage.stage)).size !== stages.length) {
    throw new Error(`${source}.stages must not contain duplicate stage names`);
  }
  const engine = root.engine;
  const usage = parseUsage(root.usage, `${source}.usage`);
  validateUsageProvider(engine, usage, `${source}.usage`);
  for (const [index, stage] of stages.entries()) {
    validateUsageProvider(engine, stage.usage, `${source}.stages[${index}].usage`);
  }
  return {
    engine,
    modelConfig: strictString(root.modelConfig, `${source}.modelConfig`, 1000),
    usage,
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    stages,
  };
}

function validateUsageProvider(
  engine: RunRecord["runner"],
  usage: ReturnType<typeof parseUsage>,
  source: string,
): void {
  const expected = engine === "claude" ? "anthropic" : engine === "codex" ? "openai" : "mock";
  if (usage.provider !== undefined && usage.provider !== expected) {
    throw new Error(`${source}.provider does not match ${engine} runner`);
  }
}

function parseStage(value: unknown, source: string): StageTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set(["stage", "model", "promptSha256", "usage", "durationMs", "completed"]), source);
  if (!(root.stage === "breadth" || root.stage === "investigation")) throw new Error(`${source}.stage is invalid`);
  const promptSha256 = strictString(root.promptSha256, `${source}.promptSha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(promptSha256)) throw new Error(`${source}.promptSha256 must be lowercase SHA-256 hex`);
  if (typeof root.completed !== "boolean") throw new Error(`${source}.completed must be boolean`);
  return {
    stage: root.stage,
    model: strictString(root.model, `${source}.model`, 500),
    promptSha256,
    usage: parseUsage(root.usage, `${source}.usage`),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    completed: root.completed,
  };
}

function assertAttemptIdentity(record: RunRecord, expected: RunAttempt, source: string): void {
  const pairs: Array<[string, unknown, unknown]> = [
    ["attemptId", record.attemptId, expected.id],
    ["caseName", record.caseName, expected.caseName],
    ["configName", record.configName, expected.configName],
    ["repeat", record.repeat, expected.repeat],
    ["caseCorpus", record.caseCorpus, expected.corpus],
    ["runner", record.runner, expected.runner],
  ];
  for (const [field, actual, wanted] of pairs) {
    if (actual !== wanted) throw new Error(`${source}.${field} does not match matrix manifest`);
  }
}

function runner(value: unknown, source: string): RunRecord["runner"] {
  if (!(value === "claude" || value === "codex" || value === "mock")) throw new Error(`${source} is invalid`);
  return value;
}

function object(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, source: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);
}

function strictString(value: unknown, source: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max) {
    throw new Error(`${source} must be a trimmed non-empty string of at most ${max} characters`);
  }
  return value;
}

function isoDate(value: unknown, source: string): string {
  const text = strictString(value, source, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== text) throw new Error(`${source} must be canonical ISO-8601 UTC`);
  return text;
}

function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function positiveSafeInteger(value: unknown, source: string): number {
  if (!safeInteger(value, 1)) throw new Error(`${source} must be a positive safe integer`);
  return value;
}

function nonNegativeSafeInteger(value: unknown, source: string): number {
  if (!safeInteger(value, 0)) throw new Error(`${source} must be a non-negative safe integer`);
  return value;
}

function corpus(value: unknown, source: string): CaseCorpus | "unknown" {
  if (value === "unknown") return value;
  if (!CASE_CORPORA.includes(value as CaseCorpus)) throw new Error(`${source} is invalid`);
  return value as CaseCorpus;
}

function parseNetworkIsolation(
  value: unknown,
  source: string,
): Partial<Record<RunRecord["runner"], NetworkIsolationCapability>> {
  const root = object(value, source);
  onlyKeys(root, new Set(["claude", "codex", "mock"]), source);
  const parsed: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>> = {};
  for (const [name, capability] of Object.entries(root)) {
    const runnerName = runner(name, `${source} key`);
    const entry = object(capability, `${source}.${name}`);
    onlyKeys(entry, new Set(["status", "mechanism"]), `${source}.${name}`);
    if (!(entry.status === "enforced" || entry.status === "limited" ||
      entry.status === "unavailable" || entry.status === "not-applicable")) {
      throw new Error(`${source}.${name}.status is invalid`);
    }
    parsed[runnerName] = {
      status: entry.status,
      mechanism: strictString(entry.mechanism, `${source}.${name}.mechanism`, 1000),
    };
  }
  return parsed;
}

function caseKind(value: unknown, source: string): RunRecord["caseKind"] {
  if (!(value === "seeded" || value === "historical" || value === "clean" || value === "unknown")) {
    throw new Error(`${source} is invalid`);
  }
  return value;
}
